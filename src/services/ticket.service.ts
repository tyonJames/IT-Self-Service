import type { TicketPriority, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { slaDueDate } from "@/lib/sla/sla";
import { ticketReference } from "@/lib/domain/tickets";
import { normaliseCountryCode } from "@/lib/config/countries";
import {
  buildStorageKey,
  validateUpload,
  TICKET_ATTACHMENT_EXTENSIONS,
  type ValidatedUpload,
} from "@/lib/security/uploads";
import { storage } from "@/lib/storage";
import { notificationService } from "./notification.service";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import {
  ticketAssigned,
  ticketReplyToAgents,
  ticketStatusChanged,
  ticketSubmittedToAgents,
  ticketSubmittedToReporter,
  type TicketEmailFacts,
} from "@/lib/email/templates";
import { ticketRepository } from "@/repositories/ticket.repository";
import { softDeleteData } from "@/repositories/soft-delete";
import { ForbiddenError } from "@/lib/permissions";
import type { AppSession } from "@/lib/auth/session";

/**
 * Ticket business logic.
 *
 * What lives here rather than in a component or a route:
 *  - SLA due-date calculation on create and on priority change (spec §3.9),
 *  - the ZA → GR country normalisation (CC-003),
 *  - matching a submitter email to an Employee record (spec §5.1),
 *  - resolving/closing timestamps,
 *  - notification enqueueing inside the same transaction as the write.
 */

export interface CreateTicketInput {
  title: string;
  description: string;
  category: string;
  deviceType: string;
  anydeskId: string;
  country: string;
  siteName: string;
  assetNumber: string;
  submitterName: string;
  submitterEmail: string;
  sendCopy: boolean;
  priority?: TicketPriority;
  createdById?: number | null;
  submittedPublicly: boolean;
  employeeId?: number | null;
  assetId?: number | null;
  assignedToId?: number | null;
  ipAddress?: string | null;
}

export interface CreatedTicket {
  id: number;
  reference: string;
  dueDate: Date | null;
}

function emailFacts(ticket: {
  id: number;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  country: string;
  siteName: string;
  submitterName: string;
  submitterEmail: string;
  dueDate: Date | null;
  createdAt: Date;
}): TicketEmailFacts {
  return { ...ticket };
}

export const ticketService = {
  /**
   * Create a ticket and queue its notifications.
   *
   * The ticket row, its attachment rows and its notification rows are written
   * in one transaction; email delivery is attempted afterwards so a slow mail
   * server cannot hold the transaction open.
   */
  async create(input: CreateTicketInput, files: File[] = []): Promise<CreatedTicket> {
    const country = input.country === "OTHER" ? "OTHER" : normaliseCountryCode(input.country);
    const priority: TicketPriority = input.priority ?? "medium";
    const createdAt = new Date();
    const dueDate = slaDueDate(createdAt, priority);

    // Match the reporter to an employee record so the ticket joins their
    // history even when it arrived through the public form (spec §5.1).
    const employeeId =
      input.employeeId ?? (await this.resolveEmployeeIdByEmail(input.submitterEmail));

    // Attachments are validated and stored *before* the transaction: a
    // rejected file should fail fast without leaving an orphan ticket, and a
    // blob write must never happen inside a database transaction.
    const prepared: ValidatedUpload[] = [];
    for (const file of files) {
      const validated = await validateUpload(file, {
        allowedExtensions: TICKET_ATTACHMENT_EXTENSIONS,
      });
      prepared.push(validated);
    }

    const { ticket, notificationIds } = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          title: input.title,
          description: input.description,
          status: "open",
          priority,
          category: input.category,
          deviceType: input.deviceType,
          anydeskId: input.anydeskId,
          country,
          siteName: input.siteName,
          assetNumber: input.assetNumber,
          submitterName: input.submitterName,
          submitterEmail: input.submitterEmail,
          sendCopy: input.sendCopy,
          createdById: input.createdById ?? null,
          submittedPublicly: input.submittedPublicly,
          assignedToId: input.assignedToId ?? null,
          employeeId,
          assetId: input.assetId ?? null,
          site: country,
          createdAt,
          dueDate,
        },
      });

      const attachmentIds: bigint[] = [];
      for (const file of prepared) {
        const key = buildStorageKey("tickets", created.id, file.filename);
        await storage().put(key, file.bytes, file.contentType);
        const row = await tx.ticketAttachment.create({
          data: {
            ticketId: created.id,
            storageKey: key,
            filename: file.filename,
            contentType: file.contentType,
            sizeBytes: file.size,
            uploadedById: input.createdById ?? null,
          },
          select: { id: true },
        });
        attachmentIds.push(row.id);
      }

      const facts = emailFacts(created);
      const ids: bigint[] = [];

      if (input.sendCopy && input.submitterEmail) {
        ids.push(
          await notificationService.enqueue(
            {
              ticketId: created.id,
              kind: "submitted",
              recipient: input.submitterEmail,
              email: ticketSubmittedToReporter(facts),
            },
            tx,
          ),
        );
      }

      const agentEmail = ticketSubmittedToAgents(facts);
      for (const recipient of notificationService.agentRecipients()) {
        ids.push(
          await notificationService.enqueue(
            {
              ticketId: created.id,
              kind: "submitted",
              recipient,
              email: agentEmail,
              attachmentIds,
            },
            tx,
          ),
        );
      }

      return { ticket: created, notificationIds: ids };
    });

    await auditService.record({
      event: SecurityEvent.TICKET_CREATED,
      message: `Ticket ${ticketReference(ticket.id)} created (${input.submittedPublicly ? "public" : "internal"})`,
      actorId: input.createdById ?? null,
      actorRepr: input.submitterEmail,
      target: "Ticket",
      targetId: ticket.id,
      ipAddress: input.ipAddress ?? null,
      detail: { priority, category: input.category, country },
    });

    // Best-effort delivery. Failures are recorded on the Notification rows and
    // retried by the scheduled job or from the notification log page.
    void notificationService.dispatchAll(notificationIds);

    return { id: ticket.id, reference: ticketReference(ticket.id), dueDate: ticket.dueDate };
  },

  async resolveEmployeeIdByEmail(email: string): Promise<number | null> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return null;
    const employee = await prisma.employee.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { email: { equals: trimmed, mode: "insensitive" } },
          { altEmail: { equals: trimmed, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    return employee?.id ?? null;
  },

  /**
   * Change status. Resolving stamps `resolvedAt`; reopening clears it, so the
   * resolution-time statistics never count a ticket that came back.
   */
  async changeStatus(
    session: AppSession,
    ticketId: number,
    status: TicketStatus,
    note: string,
    ipAddress?: string,
  ): Promise<void> {
    const existing = await prisma.ticket.findFirst({
      where: { id: ticketId, isDeleted: false },
    });
    if (!existing) throw new ForbiddenError("That ticket no longer exists.");
    if (existing.status === status && !note) return;

    const previous = existing.status;
    const isNowClosed = status === "resolved" || status === "closed";

    const { updated, notificationIds } = await prisma.$transaction(async (tx) => {
      const row = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status,
          resolvedAt: isNowClosed ? (existing.resolvedAt ?? new Date()) : null,
        },
      });

      if (note.trim()) {
        await tx.comment.create({
          data: {
            ticketId,
            authorId: session.user.id,
            body: note.trim(),
            isInternal: false,
          },
        });
      }

      const ids: bigint[] = [];
      if (row.submitterEmail) {
        ids.push(
          await notificationService.enqueue(
            {
              ticketId,
              kind: "update",
              recipient: row.submitterEmail,
              email: ticketStatusChanged(emailFacts(row), previous, note.trim()),
            },
            tx,
          ),
        );
      }
      return { updated: row, notificationIds: ids };
    });

    await auditService.record({
      event: SecurityEvent.TICKET_STATUS_CHANGED,
      message: `Ticket ${ticketReference(ticketId)} moved ${previous} → ${status}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Ticket",
      targetId: ticketId,
      ipAddress: ipAddress ?? null,
      detail: { from: previous, to: status },
    });

    void notificationService.dispatchAll(notificationIds);
    void updated;
  },

  async assign(
    session: AppSession,
    ticketId: number,
    assignedToId: number | null,
    ipAddress?: string,
  ): Promise<void> {
    const agent = assignedToId
      ? await prisma.user.findFirst({
          where: { id: assignedToId, isActive: true },
          select: { id: true, email: true, firstName: true, lastName: true, username: true },
        })
      : null;

    if (assignedToId && !agent) {
      throw new ForbiddenError("That user cannot be assigned tickets.");
    }

    const { updated, notificationIds } = await prisma.$transaction(async (tx) => {
      const row = await tx.ticket.update({
        where: { id: ticketId },
        data: { assignedToId: agent?.id ?? null },
      });

      const ids: bigint[] = [];
      if (agent?.email) {
        const agentName = `${agent.firstName} ${agent.lastName}`.trim() || agent.username;
        ids.push(
          await notificationService.enqueue(
            {
              ticketId,
              kind: "assigned",
              recipient: agent.email,
              email: ticketAssigned(emailFacts(row), agentName),
            },
            tx,
          ),
        );
      }
      return { updated: row, notificationIds: ids };
    });

    await auditService.record({
      event: SecurityEvent.TICKET_ASSIGNED,
      message: agent
        ? `Ticket ${ticketReference(ticketId)} assigned to ${agent.username}`
        : `Ticket ${ticketReference(ticketId)} unassigned`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Ticket",
      targetId: ticketId,
      ipAddress: ipAddress ?? null,
    });

    void notificationService.dispatchAll(notificationIds);
    void updated;
  },

  /**
   * Update ticket fields. A priority change recalculates the SLA deadline from
   * the original creation time, so re-triaging a ticket does not silently give
   * it a fresh clock.
   */
  async update(
    session: AppSession,
    ticketId: number,
    data: {
      priority?: TicketPriority;
      category?: string;
      employeeId?: number | null;
      assetId?: number | null;
      deviceType?: string;
      anydeskId?: string;
      siteName?: string;
      country?: string;
    },
  ): Promise<void> {
    const existing = await prisma.ticket.findFirst({
      where: { id: ticketId, isDeleted: false },
      select: { id: true, priority: true, createdAt: true },
    });
    if (!existing) throw new ForbiddenError("That ticket no longer exists.");

    const priorityChanged = data.priority !== undefined && data.priority !== existing.priority;

    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.employeeId !== undefined ? { employeeId: data.employeeId } : {}),
        ...(data.assetId !== undefined ? { assetId: data.assetId } : {}),
        ...(data.deviceType !== undefined ? { deviceType: data.deviceType } : {}),
        ...(data.anydeskId !== undefined ? { anydeskId: data.anydeskId } : {}),
        ...(data.siteName !== undefined ? { siteName: data.siteName } : {}),
        ...(data.country !== undefined
          ? {
              country: data.country === "OTHER" ? "OTHER" : normaliseCountryCode(data.country),
              site: data.country === "OTHER" ? "OTHER" : normaliseCountryCode(data.country),
            }
          : {}),
        ...(priorityChanged && data.priority
          ? { dueDate: slaDueDate(existing.createdAt, data.priority) }
          : {}),
      },
    });

    await auditService.record({
      event: SecurityEvent.TICKET_STATUS_CHANGED,
      message: `Ticket ${ticketReference(ticketId)} details updated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Ticket",
      targetId: ticketId,
      detail: { priorityChanged },
    });
  },

  /** Add a comment. A public reply notifies the agents; an internal note does not. */
  async addComment(
    session: AppSession,
    ticketId: number,
    body: string,
    isInternal: boolean,
  ): Promise<void> {
    const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, isDeleted: false } });
    if (!ticket) throw new ForbiddenError("That ticket no longer exists.");

    const notificationIds = await prisma.$transaction(async (tx) => {
      await tx.comment.create({
        data: { ticketId, authorId: session.user.id, body, isInternal },
      });

      if (isInternal) return [];

      const ids: bigint[] = [];
      const authorName = session.user.name;
      const email = ticketReplyToAgents(emailFacts(ticket), authorName, body);

      // A reply from the reporter alerts IT; a reply from IT emails the reporter.
      const isFromReporter =
        ticket.submitterEmail.toLowerCase() === session.user.email.toLowerCase();

      const recipients = isFromReporter
        ? notificationService.agentRecipients()
        : ticket.submitterEmail
          ? [ticket.submitterEmail]
          : [];

      for (const recipient of recipients) {
        ids.push(
          await notificationService.enqueue(
            { ticketId, kind: "reply", recipient, email },
            tx,
          ),
        );
      }
      return ids;
    });

    void notificationService.dispatchAll(notificationIds);
  },

  async addAttachments(session: AppSession, ticketId: number, files: File[]): Promise<number> {
    if (files.length === 0) return 0;

    let count = 0;
    for (const file of files) {
      const validated = await validateUpload(file, {
        allowedExtensions: TICKET_ATTACHMENT_EXTENSIONS,
      });
      const key = buildStorageKey("tickets", ticketId, validated.filename);
      await storage().put(key, validated.bytes, validated.contentType);
      await prisma.ticketAttachment.create({
        data: {
          ticketId,
          storageKey: key,
          filename: validated.filename,
          contentType: validated.contentType,
          sizeBytes: validated.size,
          uploadedById: session.user.id,
        },
      });
      count += 1;
    }

    await auditService.record({
      event: SecurityEvent.FILE_UPLOADED,
      message: `${count} attachment(s) added to ${ticketReference(ticketId)}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Ticket",
      targetId: ticketId,
    });

    return count;
  },

  async deleteAttachment(session: AppSession, attachmentId: bigint): Promise<number> {
    const attachment = await ticketRepository.findAttachment(attachmentId);
    if (!attachment) throw new ForbiddenError("That attachment no longer exists.");

    await prisma.ticketAttachment.delete({ where: { id: attachmentId } });
    await storage().delete(attachment.storageKey).catch(() => undefined);

    await auditService.record({
      event: SecurityEvent.FILE_DELETED,
      message: `Attachment ${attachment.filename} deleted from ${ticketReference(attachment.ticketId)}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "TicketAttachment",
      targetId: attachmentId,
    });

    return attachment.ticketId;
  },

  async softDelete(session: AppSession, ticketId: number, ipAddress?: string): Promise<void> {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: softDeleteData(session.user.id),
    });

    await auditService.record({
      event: SecurityEvent.TICKET_DELETED,
      message: `Ticket ${ticketReference(ticketId)} moved to the recycle bin`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Ticket",
      targetId: ticketId,
      ipAddress: ipAddress ?? null,
      level: "WARNING",
    });
  },
};
