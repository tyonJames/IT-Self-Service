import type { AssetCategory, AssetStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db/prisma";
import { notDeleted } from "./soft-delete";
import type { PageRequest } from "@/lib/utils/pagination";

/** Asset data access. Always scoped with `notDeleted()` (spec note 2). */

export interface AssetFilters {
  category?: AssetCategory | null;
  status?: AssetStatus | null;
  country?: string | null;
  location?: string | null;
  assignedEmployeeId?: number | null;
  assignedSiteId?: number | null;
  unassignedOnly?: boolean;
  trackingOnly?: boolean;
  search?: string | null;
  inServiceOnly?: boolean;
}

export type AssetSort = "assetTag" | "category" | "status" | "brand" | "createdAt" | "lastSeenAt";

export function buildAssetWhere(filters: AssetFilters): Prisma.AssetWhereInput {
  const where: Prisma.AssetWhereInput = { ...notDeleted() };
  const and: Prisma.AssetWhereInput[] = [];

  if (filters.category) where.category = filters.category;
  if (filters.status) where.status = filters.status;
  if (filters.country) where.site = filters.country;
  if (filters.location) where.location = filters.location;
  if (filters.assignedEmployeeId) where.assignedEmployeeId = filters.assignedEmployeeId;
  if (filters.assignedSiteId) where.assignedSiteId = filters.assignedSiteId;
  if (filters.trackingOnly) where.trackingEnabled = true;

  if (filters.inServiceOnly) {
    where.status = { notIn: ["retired", "stolen"] };
  }

  if (filters.unassignedOnly) {
    and.push({ assignedEmployeeId: null, assignedSiteId: null });
  }

  if (filters.search) {
    const term = filters.search.trim();
    and.push({
      OR: [
        { assetTag: { contains: term, mode: "insensitive" } },
        { serialNumber: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { model: { contains: term, mode: "insensitive" } },
        { assignedToName: { contains: term, mode: "insensitive" } },
        { location: { contains: term, mode: "insensitive" } },
        { macAddress: { contains: term, mode: "insensitive" } },
        { cellNumber: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

export const assetListSelect = {
  id: true,
  assetTag: true,
  category: true,
  brand: true,
  model: true,
  serialNumber: true,
  status: true,
  site: true,
  location: true,
  department: true,
  assignedToName: true,
  trackingEnabled: true,
  lastSeenAt: true,
  lastSeenLocation: true,
  assignedEmployee: { select: { id: true, fullName: true, email: true } },
  assignedSite: { select: { id: true, name: true, code: true } },
} satisfies Prisma.AssetSelect;

export type AssetListRow = Prisma.AssetGetPayload<{ select: typeof assetListSelect }>;

export const assetRepository = {
  async list(
    filters: AssetFilters,
    page: PageRequest,
    sort: AssetSort = "assetTag",
    direction: "asc" | "desc" = "asc",
    db: Db = prisma,
  ): Promise<{ rows: AssetListRow[]; total: number }> {
    const where = buildAssetWhere(filters);
    const [rows, total] = await Promise.all([
      db.asset.findMany({
        where,
        select: assetListSelect,
        // nulls last so untagged assets do not squat at the top of the register
        orderBy: [{ [sort]: { sort: direction, nulls: "last" } } as Prisma.AssetOrderByWithRelationInput, { id: "asc" }],
        skip: page.skip,
        take: page.take,
      }),
      db.asset.count({ where }),
    ]);
    return { rows, total };
  },

  async listForExport(filters: AssetFilters, db: Db = prisma) {
    return db.asset.findMany({
      where: buildAssetWhere(filters),
      orderBy: [{ site: "asc" }, { category: "asc" }, { assetTag: "asc" }],
      include: {
        assignedEmployee: { select: { fullName: true, email: true, department: true } },
        assignedSite: { select: { name: true, code: true } },
      },
    });
  },

  async findById(id: number, db: Db = prisma) {
    return db.asset.findFirst({
      where: { id, ...notDeleted() },
      include: {
        assignedEmployee: {
          select: { id: true, fullName: true, email: true, department: true, jobTitle: true, site: true, isActive: true },
        },
        assignedSite: { select: { id: true, name: true, code: true, siteCountry: true, address: true } },
        assignedToUser: { select: { id: true, username: true, email: true } },
        documents: {
          orderBy: { uploadedAt: "desc" },
          include: { uploadedBy: { select: { username: true, firstName: true, lastName: true } } },
        },
        checkins: { orderBy: { reportedAt: "desc" }, take: 50 },
      },
    });
  },

  async findBySerial(serialNumber: string, db: Db = prisma) {
    const trimmed = serialNumber.trim();
    if (!trimmed) return null;
    return db.asset.findFirst({
      where: { ...notDeleted(), serialNumber: { equals: trimmed, mode: "insensitive" } },
    });
  },

  async findByTag(assetTag: string, db: Db = prisma) {
    return db.asset.findFirst({
      where: { ...notDeleted(), assetTag: { equals: assetTag.trim().toUpperCase(), mode: "insensitive" } },
    });
  },

  async findByDeviceKeyPrefix(prefix: string, db: Db = prisma) {
    return db.asset.findFirst({
      where: { ...notDeleted(), deviceKeyPrefix: prefix, trackingEnabled: true },
      select: { id: true, deviceKeyHash: true, assetTag: true, serialNumber: true, site: true },
    });
  },

  async listForEmployee(employeeId: number, db: Db = prisma) {
    return db.asset.findMany({
      where: { ...notDeleted(), assignedEmployeeId: employeeId },
      select: assetListSelect,
      orderBy: [{ category: "asc" }, { assetTag: "asc" }],
    });
  },

  async listForSite(siteId: number, db: Db = prisma) {
    return db.asset.findMany({
      where: { ...notDeleted(), assignedSiteId: siteId },
      select: assetListSelect,
      orderBy: [{ category: "asc" }, { assetTag: "asc" }],
    });
  },

  async countByCountry(db: Db = prisma) {
    return db.asset.groupBy({
      by: ["site"],
      where: { ...notDeleted(), status: { notIn: ["retired", "stolen"] } },
      _count: { _all: true },
    });
  },

  async countByCategory(where: Prisma.AssetWhereInput = notDeleted(), db: Db = prisma) {
    return db.asset.groupBy({ by: ["category"], where, _count: { _all: true } });
  },

  async countByStatus(where: Prisma.AssetWhereInput = notDeleted(), db: Db = prisma) {
    return db.asset.groupBy({ by: ["status"], where, _count: { _all: true } });
  },

  async count(where: Prisma.AssetWhereInput = notDeleted(), db: Db = prisma) {
    return db.asset.count({ where });
  },

  /** Every tag/country/category triple, for the data-health mismatch scan. */
  async tagAuditRows(db: Db = prisma) {
    return db.asset.findMany({
      where: { ...notDeleted(), assetTag: { not: null } },
      select: { id: true, assetTag: true, site: true, category: true, assignedToName: true },
      orderBy: { assetTag: "asc" },
    });
  },

  async findDocument(id: bigint, db: Db = prisma) {
    return db.assetDocument.findUnique({
      where: { id },
      include: { asset: { select: { id: true, isDeleted: true, assetTag: true } } },
    });
  },

  /** Choices for the "which device is this about?" picker on a ticket. */
  async pickerOptions(search: string, limit = 30, db: Db = prisma) {
    return db.asset.findMany({
      where: buildAssetWhere({ search, inServiceOnly: true }),
      select: { id: true, assetTag: true, brand: true, model: true, category: true, assignedToName: true },
      orderBy: { assetTag: "asc" },
      take: limit,
    });
  },
};
