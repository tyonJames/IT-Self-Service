import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { restoreData } from "@/repositories/soft-delete";
import { storage } from "@/lib/storage";
import { daysUntilPurge } from "@/lib/utils/format";
import { ticketReference } from "@/lib/domain/tickets";
import { ForbiddenError } from "@/lib/permissions";
import type { AppSession } from "@/lib/auth/session";

/**
 * Recycle bin (spec §5.15, instruction §22).
 *
 * This is the only module permitted to query with deleted records included.
 * Purge is a real hard delete: the row goes, and so do the blobs behind its
 * attachments, because leaving orphaned files in storage is both a cost and a
 * data-retention problem.
 */

export type RecycleTab = "assets" | "employees" | "tickets" | "equipment";

export interface RecycleRow {
  id: number;
  label: string;
  sublabel: string;
  deletedAt: Date | null;
  deletedBy: string;
  daysRemaining: number;
}

const deletedByRepr = (user: { username: string; firstName: string; lastName: string } | null): string => {
  if (!user) return "—";
  return `${user.firstName} ${user.lastName}`.trim() || user.username;
};

export const recycleBinService = {
  async list(tab: RecycleTab, skip: number, take: number): Promise<{ rows: RecycleRow[]; total: number }> {
    const deletedBySelect = { select: { username: true, firstName: true, lastName: true } };

    if (tab === "assets") {
      const where = { isDeleted: true };
      const [rows, total] = await Promise.all([
        prisma.asset.findMany({
          where,
          orderBy: { deletedAt: "desc" },
          skip,
          take,
          select: {
            id: true,
            assetTag: true,
            brand: true,
            model: true,
            category: true,
            assignedToName: true,
            deletedAt: true,
            deletedBy: deletedBySelect,
          },
        }),
        prisma.asset.count({ where }),
      ]);
      return {
        total,
        rows: rows.map((r) => ({
          id: r.id,
          label: r.assetTag ?? `Asset #${r.id}`,
          sublabel: [`${r.brand} ${r.model}`.trim(), r.assignedToName].filter(Boolean).join(" · ") || r.category,
          deletedAt: r.deletedAt,
          deletedBy: deletedByRepr(r.deletedBy),
          daysRemaining: daysUntilPurge(r.deletedAt),
        })),
      };
    }

    if (tab === "employees") {
      const where = { isDeleted: true };
      const [rows, total] = await Promise.all([
        prisma.employee.findMany({
          where,
          orderBy: { deletedAt: "desc" },
          skip,
          take,
          select: {
            id: true,
            fullName: true,
            email: true,
            department: true,
            deletedAt: true,
            deletedBy: deletedBySelect,
          },
        }),
        prisma.employee.count({ where }),
      ]);
      return {
        total,
        rows: rows.map((r) => ({
          id: r.id,
          label: r.fullName,
          sublabel: [r.email, r.department].filter(Boolean).join(" · "),
          deletedAt: r.deletedAt,
          deletedBy: deletedByRepr(r.deletedBy),
          daysRemaining: daysUntilPurge(r.deletedAt),
        })),
      };
    }

    if (tab === "tickets") {
      const where = { isDeleted: true };
      const [rows, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          orderBy: { deletedAt: "desc" },
          skip,
          take,
          select: {
            id: true,
            title: true,
            submitterName: true,
            status: true,
            deletedAt: true,
            deletedBy: deletedBySelect,
          },
        }),
        prisma.ticket.count({ where }),
      ]);
      return {
        total,
        rows: rows.map((r) => ({
          id: r.id,
          label: `${ticketReference(r.id)} — ${r.title}`,
          sublabel: [r.submitterName, r.status].filter(Boolean).join(" · "),
          deletedAt: r.deletedAt,
          deletedBy: deletedByRepr(r.deletedBy),
          daysRemaining: daysUntilPurge(r.deletedAt),
        })),
      };
    }

    const where = { isDeleted: true };
    const [rows, total] = await Promise.all([
      prisma.equipmentRequest.findMany({
        where,
        orderBy: { deletedAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          requesterName: true,
          requesterEmail: true,
          status: true,
          deletedAt: true,
          deletedBy: deletedBySelect,
        },
      }),
      prisma.equipmentRequest.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        label: `Request #${r.id} — ${r.requesterName}`,
        sublabel: [r.requesterEmail, r.status].filter(Boolean).join(" · "),
        deletedAt: r.deletedAt,
        deletedBy: deletedByRepr(r.deletedBy),
        daysRemaining: daysUntilPurge(r.deletedAt),
      })),
    };
  },

  async counts(): Promise<Record<RecycleTab, number>> {
    const [assets, employees, tickets, equipment] = await Promise.all([
      prisma.asset.count({ where: { isDeleted: true } }),
      prisma.employee.count({ where: { isDeleted: true } }),
      prisma.ticket.count({ where: { isDeleted: true } }),
      prisma.equipmentRequest.count({ where: { isDeleted: true } }),
    ]);
    return { assets, employees, tickets, equipment };
  },

  async restore(session: AppSession, tab: RecycleTab, id: number): Promise<void> {
    const data = restoreData();

    switch (tab) {
      case "assets": {
        // Defence in depth. The unique index on asset_tag covers deleted rows,
        // so a live record cannot currently hold a deleted one's tag — this
        // check exists so that making that index partial later would fail
        // loudly here rather than silently resurrecting a duplicate.
        const asset = await prisma.asset.findFirst({
          where: { id, isDeleted: true },
          select: { assetTag: true },
        });
        if (!asset) throw new ForbiddenError("That record is not in the recycle bin.");
        if (asset.assetTag) {
          const clash = await prisma.asset.findFirst({
            where: { assetTag: asset.assetTag, isDeleted: false },
            select: { id: true },
          });
          if (clash) {
            throw new ForbiddenError(
              `Asset tag ${asset.assetTag} has been reissued to another record. Change that tag first.`,
            );
          }
        }
        await prisma.asset.update({ where: { id }, data });
        break;
      }
      case "employees": {
        const employee = await prisma.employee.findFirst({
          where: { id, isDeleted: true },
          select: { email: true },
        });
        if (!employee) throw new ForbiddenError("That record is not in the recycle bin.");
        const clash = await prisma.employee.findFirst({
          where: { email: employee.email, isDeleted: false },
          select: { id: true },
        });
        if (clash) {
          throw new ForbiddenError(
            `Another active employee now uses ${employee.email}. Resolve that first.`,
          );
        }
        await prisma.employee.update({ where: { id }, data });
        break;
      }
      case "tickets":
        await prisma.ticket.update({ where: { id }, data });
        break;
      case "equipment":
        await prisma.equipmentRequest.update({ where: { id }, data });
        break;
    }

    await auditService.record({
      event: SecurityEvent.RECORD_RESTORED,
      message: `${tab} record #${id} restored from the recycle bin`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: tab,
      targetId: id,
    });
  },

  /**
   * Permanent delete. Admin-only at the call site (instruction §22). Blobs go
   * first: if the row deletion fails afterwards the retry simply finds nothing
   * left to remove, whereas the reverse order would leak files forever.
   */
  async purge(session: AppSession, tab: RecycleTab, id: number): Promise<void> {
    switch (tab) {
      case "assets": {
        const docs = await prisma.assetDocument.findMany({
          where: { assetId: id },
          select: { storageKey: true },
        });
        for (const doc of docs) await storage().delete(doc.storageKey).catch(() => undefined);
        await prisma.asset.delete({ where: { id } });
        break;
      }
      case "employees":
        await prisma.employee.delete({ where: { id } });
        break;
      case "tickets": {
        const attachments = await prisma.ticketAttachment.findMany({
          where: { ticketId: id },
          select: { storageKey: true },
        });
        for (const a of attachments) await storage().delete(a.storageKey).catch(() => undefined);
        await prisma.ticket.delete({ where: { id } });
        break;
      }
      case "equipment":
        await prisma.equipmentRequest.delete({ where: { id } });
        break;
    }

    await auditService.record({
      event: SecurityEvent.RECORD_PURGED,
      message: `${tab} record #${id} permanently deleted`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: tab,
      targetId: id,
      level: "CRITICAL",
    });
  },

  /**
   * Automatic purge after the retention window (spec §5.15). Invoked by the
   * scheduled-job endpoint, not by a cron process — Azure App Service has no
   * dependable cron (instruction §22).
   */
  async purgeExpired(): Promise<Record<RecycleTab, number>> {
    const cutoff = new Date(Date.now() - env().RECYCLE_BIN_RETENTION_DAYS * 86_400_000);
    const where = { isDeleted: true, deletedAt: { lte: cutoff } };

    const staleAssets = await prisma.asset.findMany({ where, select: { id: true } });
    for (const asset of staleAssets) {
      const docs = await prisma.assetDocument.findMany({
        where: { assetId: asset.id },
        select: { storageKey: true },
      });
      for (const doc of docs) await storage().delete(doc.storageKey).catch(() => undefined);
    }

    const staleTickets = await prisma.ticket.findMany({ where, select: { id: true } });
    for (const ticket of staleTickets) {
      const attachments = await prisma.ticketAttachment.findMany({
        where: { ticketId: ticket.id },
        select: { storageKey: true },
      });
      for (const a of attachments) await storage().delete(a.storageKey).catch(() => undefined);
    }

    const [assets, employees, tickets, equipment] = await prisma.$transaction([
      prisma.asset.deleteMany({ where }),
      prisma.employee.deleteMany({ where }),
      prisma.ticket.deleteMany({ where }),
      prisma.equipmentRequest.deleteMany({ where }),
    ]);

    const result = {
      assets: assets.count,
      employees: employees.count,
      tickets: tickets.count,
      equipment: equipment.count,
    };

    const total = Object.values(result).reduce((a, b) => a + b, 0);
    if (total > 0) {
      await auditService.record({
        event: SecurityEvent.RECORD_PURGED,
        message: `Scheduled purge removed ${total} record(s) past the ${env().RECYCLE_BIN_RETENTION_DAYS}-day retention window`,
        actorRepr: "scheduled-job",
        target: "RecycleBin",
        level: "WARNING",
        detail: result,
      });
    }

    return result;
  },
};
