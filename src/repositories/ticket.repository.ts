import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { prisma, type Db } from "@/lib/db/prisma";
import { notDeleted } from "./soft-delete";
import type { PageRequest } from "@/lib/utils/pagination";
import { parseTicketReference } from "@/lib/domain/tickets";

/**
 * Ticket data access. Every query here is scoped with `notDeleted()`; the
 * recycle bin is the only place that sees deleted tickets, and it uses
 * `recycleBinRepository`.
 */

export interface TicketFilters {
  status?: TicketStatus | null;
  statusIn?: TicketStatus[] | null;
  priority?: TicketPriority | null;
  category?: string | null;
  country?: string | null;
  assignedToId?: number | null;
  /** Only tickets this staff user is allowed to see. */
  visibleToUser?: { userId: number; email: string } | null;
  /** Free-text across reference, title, description, submitter, asset number. */
  search?: string | null;
  overdueOnly?: boolean;
  unassignedOnly?: boolean;
  createdFrom?: Date | null;
  createdTo?: Date | null;
}

export type TicketSort =
  | "createdAt"
  | "updatedAt"
  | "dueDate"
  | "priority"
  | "status"
  | "title";

export function buildTicketWhere(filters: TicketFilters): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = { ...notDeleted() };
  const and: Prisma.TicketWhereInput[] = [];

  if (filters.status) where.status = filters.status;
  else if (filters.statusIn && filters.statusIn.length > 0) where.status = { in: filters.statusIn };

  if (filters.priority) where.priority = filters.priority;
  if (filters.category) where.category = filters.category;
  if (filters.country) where.country = filters.country;
  if (filters.assignedToId !== undefined && filters.assignedToId !== null) {
    where.assignedToId = filters.assignedToId;
  }
  if (filters.unassignedOnly) where.assignedToId = null;

  if (filters.createdFrom || filters.createdTo) {
    where.createdAt = {
      ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
      ...(filters.createdTo ? { lte: filters.createdTo } : {}),
    };
  }

  if (filters.overdueOnly) {
    // Overdue means past its deadline and not yet resolved or closed.
    and.push({
      dueDate: { not: null, lt: new Date() },
      status: { notIn: ["resolved", "closed"] },
    });
  }

  if (filters.search) {
    const term = filters.search.trim();
    const ref = parseTicketReference(term);
    const or: Prisma.TicketWhereInput[] = [
      { title: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
      { submitterName: { contains: term, mode: "insensitive" } },
      { submitterEmail: { contains: term, mode: "insensitive" } },
      { assetNumber: { contains: term, mode: "insensitive" } },
      { siteName: { contains: term, mode: "insensitive" } },
    ];
    if (ref !== null) or.push({ id: ref });
    and.push({ OR: or });
  }

  // Staff visibility — the same rule as canViewTicket(), expressed in SQL so
  // the list query itself cannot leak another user's ticket.
  if (filters.visibleToUser) {
    const { userId, email } = filters.visibleToUser;
    and.push({
      OR: [
        { createdById: userId },
        ...(email ? [{ submitterEmail: { equals: email, mode: "insensitive" as const } }] : []),
        { employee: { userId } },
        ...(email ? [{ employee: { email: { equals: email, mode: "insensitive" as const } } }] : []),
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

function orderBy(sort: TicketSort, direction: "asc" | "desc"): Prisma.TicketOrderByWithRelationInput[] {
  // Secondary key keeps pagination stable when the primary key ties.
  return [{ [sort]: direction } as Prisma.TicketOrderByWithRelationInput, { id: "desc" }];
}

export const ticketListSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  category: true,
  country: true,
  siteName: true,
  submitterName: true,
  submitterEmail: true,
  createdAt: true,
  dueDate: true,
  resolvedAt: true,
  assignedTo: { select: { id: true, firstName: true, lastName: true, username: true } },
  employee: { select: { id: true, fullName: true } },
} satisfies Prisma.TicketSelect;

export type TicketListRow = Prisma.TicketGetPayload<{ select: typeof ticketListSelect }>;

export const ticketRepository = {
  async list(
    filters: TicketFilters,
    page: PageRequest,
    sort: TicketSort = "createdAt",
    direction: "asc" | "desc" = "desc",
    db: Db = prisma,
  ): Promise<{ rows: TicketListRow[]; total: number }> {
    const where = buildTicketWhere(filters);
    const [rows, total] = await Promise.all([
      db.ticket.findMany({
        where,
        select: ticketListSelect,
        orderBy: orderBy(sort, direction),
        skip: page.skip,
        take: page.take,
      }),
      db.ticket.count({ where }),
    ]);
    return { rows, total };
  },

  /** Unpaginated, projected for exports and reports. Filters still apply. */
  async listForExport(filters: TicketFilters, db: Db = prisma) {
    return db.ticket.findMany({
      where: buildTicketWhere(filters),
      orderBy: { id: "asc" },
      include: {
        assignedTo: { select: { firstName: true, lastName: true, username: true, email: true } },
        employee: { select: { fullName: true, email: true, department: true } },
        asset: { select: { assetTag: true, brand: true, model: true } },
      },
    });
  },

  async findById(id: number, db: Db = prisma) {
    return db.ticket.findFirst({
      where: { id, ...notDeleted() },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, username: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, username: true, email: true } },
        employee: {
          select: { id: true, fullName: true, email: true, department: true, jobTitle: true, userId: true, site: true },
        },
        asset: {
          select: { id: true, assetTag: true, brand: true, model: true, category: true, status: true, serialNumber: true },
        },
        assets: { select: { id: true, assetTag: true, brand: true, model: true, category: true } },
        attachments: {
          orderBy: { uploadedAt: "asc" },
          include: { uploadedBy: { select: { firstName: true, lastName: true, username: true } } },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, firstName: true, lastName: true, username: true } } },
        },
      },
    });
  },

  /** Ownership facts only — cheap enough to call before a download. */
  async findOwnershipFacts(id: number, db: Db = prisma) {
    return db.ticket.findFirst({
      where: { id, ...notDeleted() },
      select: {
        id: true,
        createdById: true,
        submitterEmail: true,
        employee: { select: { userId: true, email: true } },
      },
    });
  },

  async countByStatus(where: Prisma.TicketWhereInput, db: Db = prisma) {
    return db.ticket.groupBy({ by: ["status"], where, _count: { _all: true } });
  },

  async countByPriority(where: Prisma.TicketWhereInput, db: Db = prisma) {
    return db.ticket.groupBy({ by: ["priority"], where, _count: { _all: true } });
  },

  async countByCategory(where: Prisma.TicketWhereInput, db: Db = prisma) {
    return db.ticket.groupBy({ by: ["category"], where, _count: { _all: true } });
  },

  async countByCountry(where: Prisma.TicketWhereInput, db: Db = prisma) {
    return db.ticket.groupBy({ by: ["country"], where, _count: { _all: true } });
  },

  async count(where: Prisma.TicketWhereInput, db: Db = prisma) {
    return db.ticket.count({ where });
  },

  /** Minimal projection for SLA maths — avoids pulling descriptions into memory. */
  async slaFacts(where: Prisma.TicketWhereInput, db: Db = prisma) {
    return db.ticket.findMany({
      where,
      select: { id: true, priority: true, createdAt: true, dueDate: true, resolvedAt: true, status: true },
      orderBy: { createdAt: "asc" },
    });
  },

  /** Daily ticket counts for the trend chart. */
  async dailyCounts(from: Date, to: Date, extra: Prisma.TicketWhereInput = {}, db: Db = prisma) {
    return db.ticket.findMany({
      where: { ...notDeleted(), ...extra, createdAt: { gte: from, lte: to } },
      select: { createdAt: true, resolvedAt: true },
      orderBy: { createdAt: "asc" },
    });
  },

  /** Fault history for an asset's 360 view. */
  async listForAsset(assetId: number, db: Db = prisma) {
    return db.ticket.findMany({
      where: { ...notDeleted(), assetId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        category: true,
        createdAt: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async listForEmployee(employeeId: number, db: Db = prisma) {
    return db.ticket.findMany({
      where: { ...notDeleted(), employeeId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        category: true,
        createdAt: true,
        dueDate: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Fault counts for many assets at once — feeds the register's health column. */
  async faultCountsByAsset(assetIds: number[], db: Db = prisma): Promise<Map<number, number>> {
    if (assetIds.length === 0) return new Map();
    const rows = await db.ticket.groupBy({
      by: ["assetId"],
      where: { ...notDeleted(), assetId: { in: assetIds } },
      _count: { _all: true },
    });
    const map = new Map<number, number>();
    for (const row of rows) {
      if (row.assetId !== null) map.set(row.assetId, row._count._all);
    }
    return map;
  },

  async findAttachment(id: bigint, db: Db = prisma) {
    return db.ticketAttachment.findUnique({
      where: { id },
      include: {
        ticket: {
          select: {
            id: true,
            isDeleted: true,
            createdById: true,
            submitterEmail: true,
            employee: { select: { userId: true, email: true } },
          },
        },
      },
    });
  },

  async findAttachmentsByIds(ids: bigint[], db: Db = prisma) {
    if (ids.length === 0) return [];
    return db.ticketAttachment.findMany({ where: { id: { in: ids } } });
  },
};
