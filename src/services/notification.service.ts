import type { NotificationKind, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db/prisma";
import { emailProvider, EmailDeliveryError } from "@/lib/email";
import { storage } from "@/lib/storage";
import { logger } from "@/lib/logging/logger";
import { env } from "@/lib/config/env";
import type { RenderedEmail } from "@/lib/email/templates";

/**
 * Notification service (instruction §13, spec §5.18).
 *
 * The rule: no email is ever sent without a Notification row. `enqueue` writes
 * the row — inside the caller's transaction when one is supplied, so a ticket
 * and its notification are committed together or not at all — and `dispatch`
 * attempts delivery afterwards, recording `sent` or `failed` with the attempt
 * count and the error text.
 *
 * Delivery deliberately happens *after* the transaction commits: holding a
 * database transaction open across an SMTP round trip is how you exhaust a
 * connection pool when the mail server is slow.
 */

export const MAX_ATTEMPTS = 5;

export interface EnqueueInput {
  ticketId?: number | null;
  kind: NotificationKind;
  recipient: string;
  email: RenderedEmail;
  attachmentIds?: bigint[];
}

function serialiseAttachmentIds(ids: bigint[] | undefined): string {
  if (!ids || ids.length === 0) return "";
  return ids.map((id) => id.toString()).join(",");
}

function parseAttachmentIds(raw: string): bigint[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return BigInt(s);
      } catch {
        return null;
      }
    })
    .filter((v): v is bigint => v !== null);
}

export const notificationService = {
  /**
   * Record an intended email. Returns the row id so the caller can dispatch
   * it once its transaction has committed.
   */
  async enqueue(input: EnqueueInput, db: Db = prisma): Promise<bigint> {
    const row = await db.notification.create({
      data: {
        ticketId: input.ticketId ?? null,
        kind: input.kind,
        recipient: input.recipient.trim().toLowerCase(),
        subject: input.email.subject,
        body: input.email.text,
        attachmentIds: serialiseAttachmentIds(input.attachmentIds),
        status: "pending",
      },
      select: { id: true },
    });
    return row.id;
  },

  /** Enqueue one notification per recipient, skipping blanks and duplicates. */
  async enqueueMany(
    recipients: string[],
    build: (recipient: string) => EnqueueInput,
    db: Db = prisma,
  ): Promise<bigint[]> {
    const unique = [...new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean))];
    const ids: bigint[] = [];
    for (const recipient of unique) {
      ids.push(await this.enqueue(build(recipient), db));
    }
    return ids;
  },

  /**
   * Attempt delivery of one notification.
   *
   * This method never rejects. Callers invoke it *after* their transaction has
   * committed and deliberately do not await it, so a rejection here would
   * become an unhandled promise rejection — which, under Node's default
   * `--unhandled-rejections=throw`, takes the whole worker down. A slow mail
   * server, a purged row, or a database blip must cost at most one email.
   */
  async dispatch(notificationId: bigint): Promise<boolean> {
    try {
      const row = await prisma.notification.findUnique({ where: { id: notificationId } });
      if (!row) return false;
      if (row.status === "sent") return true;
      if (row.attempts >= MAX_ATTEMPTS) return false;

      const attachments = await this.loadAttachments(row.attachmentIds);

      try {
        await emailProvider().send({
          to: row.recipient,
          subject: row.subject,
          text: row.body,
          attachments,
        });

        await prisma.notification.update({
          where: { id: row.id },
          data: { status: "sent", sentAt: new Date(), attempts: row.attempts + 1, lastError: "" },
        });
        return true;
      } catch (error) {
        const err = error as EmailDeliveryError;
        const attempts = row.attempts + 1;
        const permanent = err instanceof EmailDeliveryError && err.permanent;

        // The row may have been purged between the read and here; recording the
        // failure is best-effort, and the log line is what actually matters.
        await prisma.notification
          .update({
            where: { id: row.id },
            data: {
              status: "failed",
              attempts: permanent ? MAX_ATTEMPTS : attempts,
              lastError: (err.message ?? "Unknown delivery error").slice(0, 2000),
            },
          })
          .catch(() => undefined);

        logger().warn(
          { notificationId: row.id.toString(), attempts, permanent },
          "Email delivery failed",
        );
        return false;
      }
    } catch (error) {
      logger().error(
        { notificationId: notificationId.toString(), err: (error as Error).message },
        "Notification dispatch failed before delivery could be attempted",
      );
      return false;
    }
  },

  /** Fire-and-record: dispatch several notifications without blocking on failures. */
  async dispatchAll(ids: bigint[]): Promise<void> {
    for (const id of ids) {
      await this.dispatch(id);
    }
  },

  /**
   * Attachments are fetched from storage at send time rather than being held
   * in the row: the row stays small, and a rotated storage key cannot resurrect
   * a stale copy.
   */
  async loadAttachments(attachmentIds: string) {
    const ids = parseAttachmentIds(attachmentIds);
    if (ids.length === 0) return undefined;

    const rows = await prisma.ticketAttachment.findMany({ where: { id: { in: ids } } });
    const out = [];
    for (const row of rows) {
      try {
        const content = await storage().get(row.storageKey);
        if (content.length > env().MAX_UPLOAD_BYTES) continue;
        out.push({ filename: row.filename, content, contentType: row.contentType });
      } catch {
        logger().warn({ attachmentId: row.id.toString() }, "Attachment missing at send time; skipped");
      }
    }
    return out.length > 0 ? out : undefined;
  },

  /** Retry a single failed notification — the button on the notification log. */
  async retry(notificationId: bigint): Promise<boolean> {
    const row = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!row) return false;
    if (row.status === "sent") return true;
    if (row.attempts >= MAX_ATTEMPTS) return false;

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: "pending" },
    });
    return this.dispatch(notificationId);
  },

  /** Sweep every retryable notification — the scheduled job. */
  async retryAllFailed(limit = 100): Promise<{ attempted: number; sent: number }> {
    const rows = await prisma.notification.findMany({
      where: { status: { in: ["failed", "pending"] }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    });

    let sent = 0;
    for (const row of rows) {
      if (await this.dispatch(row.id)) sent += 1;
    }
    return { attempted: rows.length, sent };
  },

  async list(
    filters: { status?: "pending" | "sent" | "failed"; ticketId?: number; search?: string },
    skip: number,
    take: number,
  ) {
    const where: Prisma.NotificationWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.ticketId ? { ticketId: filters.ticketId } : {}),
      ...(filters.search
        ? {
            OR: [
              { recipient: { contains: filters.search, mode: "insensitive" } },
              { subject: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          ticketId: true,
          kind: true,
          recipient: true,
          subject: true,
          status: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          sentAt: true,
        },
      }),
      prisma.notification.count({ where }),
    ]);

    return { rows, total };
  },

  async statusCounts() {
    const rows = await prisma.notification.groupBy({ by: ["status"], _count: { _all: true } });
    const counts = { pending: 0, sent: 0, failed: 0 };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  },

  /** Where new-ticket alerts go (IT_NOTIFY_EMAILS, falling back to SUPPORT_EMAIL). */
  agentRecipients(): string[] {
    const e = env();
    const configured = e.IT_NOTIFY_EMAILS.filter(Boolean);
    if (configured.length > 0) return configured;
    return e.SUPPORT_EMAIL ? [e.SUPPORT_EMAIL] : [];
  },
};
