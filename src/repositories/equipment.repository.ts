import type { EquipmentStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db/prisma";
import { notDeleted } from "./soft-delete";
import type { PageRequest } from "@/lib/utils/pagination";
import { CLOSED_EQUIPMENT_STATUSES, OPEN_EQUIPMENT_STATUSES } from "@/lib/domain/equipment-status";

export interface EquipmentFilters {
  status?: EquipmentStatus | null;
  openness?: "open" | "closed" | "all";
  country?: string | null;
  priority?: "normal" | "urgent" | null;
  search?: string | null;
}

export function buildEquipmentWhere(filters: EquipmentFilters): Prisma.EquipmentRequestWhereInput {
  const where: Prisma.EquipmentRequestWhereInput = { ...notDeleted() };

  if (filters.status) {
    where.status = filters.status;
  } else if (filters.openness === "open") {
    where.status = { in: OPEN_EQUIPMENT_STATUSES };
  } else if (filters.openness === "closed") {
    where.status = { in: CLOSED_EQUIPMENT_STATUSES };
  }

  if (filters.country) where.country = filters.country;
  if (filters.priority) where.priority = filters.priority;

  if (filters.search) {
    const term = filters.search.trim();
    const numeric = Number.parseInt(term.replace(/^#/, ""), 10);
    where.OR = [
      { requesterName: { contains: term, mode: "insensitive" } },
      { requesterEmail: { contains: term, mode: "insensitive" } },
      { department: { contains: term, mode: "insensitive" } },
      { siteName: { contains: term, mode: "insensitive" } },
      { reason: { contains: term, mode: "insensitive" } },
      { otherEquipment: { contains: term, mode: "insensitive" } },
      ...(Number.isSafeInteger(numeric) && numeric > 0 ? [{ id: numeric }] : []),
    ];
  }

  return where;
}

export const equipmentRepository = {
  async list(filters: EquipmentFilters, page: PageRequest, db: Db = prisma) {
    const where = buildEquipmentWhere(filters);
    const [rows, total] = await Promise.all([
      db.equipmentRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          requesterName: true,
          requesterEmail: true,
          department: true,
          country: true,
          siteName: true,
          priority: true,
          status: true,
          otherEquipment: true,
          createdAt: true,
          decidedAt: true,
          items: { select: { item: true, quantity: true } },
          employee: { select: { id: true, fullName: true } },
        },
      }),
      db.equipmentRequest.count({ where }),
    ]);
    return { rows, total };
  },

  async findById(id: number, db: Db = prisma) {
    return db.equipmentRequest.findFirst({
      where: { id, ...notDeleted() },
      include: {
        items: { orderBy: { item: "asc" } },
        employee: { select: { id: true, fullName: true, email: true, department: true, jobTitle: true, site: true } },
        site: { select: { id: true, name: true, code: true, siteCountry: true } },
        decidedBy: { select: { id: true, username: true, firstName: true, lastName: true } },
        issuedAssets: {
          select: { id: true, assetTag: true, brand: true, model: true, category: true, status: true },
        },
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
  },

  /** The confirmation page after a public submission — no session required,
   *  so it exposes only what the requester already typed. */
  async findPublicConfirmation(id: number, db: Db = prisma) {
    return db.equipmentRequest.findFirst({
      where: { id, ...notDeleted() },
      select: {
        id: true,
        requesterName: true,
        requesterEmail: true,
        country: true,
        siteName: true,
        priority: true,
        status: true,
        otherEquipment: true,
        createdAt: true,
        items: { select: { item: true, quantity: true } },
      },
    });
  },

  async listForEmployee(employeeId: number, db: Db = prisma) {
    return db.equipmentRequest.findMany({
      where: { ...notDeleted(), employeeId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        priority: true,
        createdAt: true,
        decidedAt: true,
        items: { select: { item: true, quantity: true } },
      },
    });
  },

  async countByStatus(db: Db = prisma) {
    return db.equipmentRequest.groupBy({
      by: ["status"],
      where: notDeleted(),
      _count: { _all: true },
    });
  },

  async count(where: Prisma.EquipmentRequestWhereInput = notDeleted(), db: Db = prisma) {
    return db.equipmentRequest.count({ where });
  },
};
