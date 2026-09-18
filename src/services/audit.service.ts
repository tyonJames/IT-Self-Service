import { prisma, type Db } from "@/lib/db/prisma";
import { safeDetail, securityLog, type LogDetail, type SecurityEventName, type SecurityLevel } from "@/lib/logging/logger";

/**
 * Persistent audit trail (instruction §27).
 *
 * Every call also emits the stdout security line, because the two serve
 * different purposes: the log is for alerting and survives a database outage,
 * the table is for "who changed this record, and when" six months later.
 *
 * Writes are best-effort — an audit failure must not roll back the action it
 * describes, but it is logged loudly when it happens.
 */

export interface AuditInput {
  event: SecurityEventName;
  message: string;
  level?: SecurityLevel;
  actorId?: number | null;
  actorRepr?: string;
  target?: string;
  targetId?: string | number | bigint;
  ipAddress?: string | null;
  detail?: LogDetail;
}

export const auditService = {
  async record(input: AuditInput, db: Db = prisma): Promise<void> {
    securityLog(input.event, input.message, input.level ?? "INFO", {
      actorId: input.actorId ?? undefined,
      actor: input.actorRepr,
      target: input.target,
      targetId: input.targetId?.toString(),
      ip: input.ipAddress ?? undefined,
      ...input.detail,
    });

    try {
      await db.auditLog.create({
        data: {
          event: input.event,
          actorId: input.actorId ?? null,
          actorRepr: input.actorRepr ?? "",
          target: input.target ?? "",
          targetId: input.targetId?.toString() ?? "",
          ipAddress: input.ipAddress ?? null,
          detail: { ...safeDetail(input.detail), message: input.message },
        },
      });
    } catch (error) {
      securityLog(
        input.event,
        `Audit row could not be written: ${(error as Error).message}`,
        "ERROR",
      );
    }
  },

  async listForTarget(target: string, targetId: string, limit = 50) {
    return prisma.auditLog.findMany({
      where: { target, targetId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { actor: { select: { username: true, firstName: true, lastName: true } } },
    });
  },
};
