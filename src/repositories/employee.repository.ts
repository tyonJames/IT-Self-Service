import type { Prisma, StaffGroup } from "@prisma/client";
import { prisma, type Db } from "@/lib/db/prisma";
import { notDeleted } from "./soft-delete";
import type { PageRequest } from "@/lib/utils/pagination";

/** Employee data access. Always scoped with `notDeleted()`. */

export interface EmployeeFilters {
  activeOnly?: boolean;
  suspendedOnly?: boolean;
  country?: string | null;
  department?: string | null;
  staffGroup?: StaffGroup | null;
  search?: string | null;
}

export function buildEmployeeWhere(filters: EmployeeFilters): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { ...notDeleted() };

  if (filters.activeOnly) where.isActive = true;
  if (filters.suspendedOnly) where.isActive = false;
  if (filters.country) where.site = filters.country;
  if (filters.department) where.department = filters.department;
  if (filters.staffGroup) where.staffGroup = filters.staffGroup;

  if (filters.search) {
    const term = filters.search.trim();
    where.OR = [
      { fullName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { altEmail: { contains: term, mode: "insensitive" } },
      { employeeNumber: { contains: term, mode: "insensitive" } },
      { department: { contains: term, mode: "insensitive" } },
      { jobTitle: { contains: term, mode: "insensitive" } },
      { phone: { contains: term, mode: "insensitive" } },
    ];
  }

  return where;
}

export const employeeListSelect = {
  id: true,
  fullName: true,
  email: true,
  altEmail: true,
  phone: true,
  department: true,
  jobTitle: true,
  site: true,
  employeeNumber: true,
  staffGroup: true,
  isActive: true,
  emailPasswordSetAt: true,
  userId: true,
} satisfies Prisma.EmployeeSelect;

export type EmployeeListRow = Prisma.EmployeeGetPayload<{ select: typeof employeeListSelect }>;

export const employeeRepository = {
  async list(
    filters: EmployeeFilters,
    page: PageRequest,
    db: Db = prisma,
  ): Promise<{ rows: EmployeeListRow[]; total: number }> {
    const where = buildEmployeeWhere(filters);
    const [rows, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: employeeListSelect,
        orderBy: [{ fullName: "asc" }],
        skip: page.skip,
        take: page.take,
      }),
      db.employee.count({ where }),
    ]);
    return { rows, total };
  },

  /** Unpaginated — the register exports and the grouped list views. */
  async listAll(filters: EmployeeFilters, db: Db = prisma): Promise<EmployeeListRow[]> {
    return db.employee.findMany({
      where: buildEmployeeWhere(filters),
      select: employeeListSelect,
      orderBy: [{ staffGroup: "asc" }, { site: "asc" }, { fullName: "asc" }],
    });
  },

  async findById(id: number, db: Db = prisma) {
    return db.employee.findFirst({
      where: { id, ...notDeleted() },
      include: {
        user: { select: { id: true, username: true, email: true, isActive: true } },
      },
    });
  },

  async findByEmail(email: string, db: Db = prisma) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return null;
    return db.employee.findFirst({
      where: {
        ...notDeleted(),
        OR: [
          { email: { equals: trimmed, mode: "insensitive" } },
          { altEmail: { equals: trimmed, mode: "insensitive" } },
        ],
      },
    });
  },

  async countByCountry(activeOnly = true, db: Db = prisma) {
    return db.employee.groupBy({
      by: ["site"],
      where: { ...notDeleted(), ...(activeOnly ? { isActive: true } : {}) },
      _count: { _all: true },
    });
  },

  async countByDepartment(activeOnly = true, db: Db = prisma) {
    return db.employee.groupBy({
      by: ["department"],
      where: { ...notDeleted(), ...(activeOnly ? { isActive: true } : {}) },
      _count: { _all: true },
      orderBy: { _count: { department: "desc" } },
    });
  },

  async count(where: Prisma.EmployeeWhereInput = notDeleted(), db: Db = prisma) {
    return db.employee.count({ where });
  },

  /** Distinct departments, for filter dropdowns. */
  async departments(db: Db = prisma): Promise<string[]> {
    const rows = await db.employee.findMany({
      where: { ...notDeleted(), department: { not: "" } },
      select: { department: true },
      distinct: ["department"],
      orderBy: { department: "asc" },
    });
    return rows.map((r) => r.department);
  },

  /**
   * Counts used across the 360 view, gathered in one grouped query per metric
   * rather than four queries per employee.
   */
  async assetCounts(employeeIds: number[], db: Db = prisma) {
    if (employeeIds.length === 0) return { assigned: new Map<number, number>(), active: new Map<number, number>() };

    const [assignedRows, activeRows] = await Promise.all([
      db.asset.groupBy({
        by: ["assignedEmployeeId"],
        where: { isDeleted: false, assignedEmployeeId: { in: employeeIds } },
        _count: { _all: true },
      }),
      db.asset.groupBy({
        by: ["assignedEmployeeId"],
        where: {
          isDeleted: false,
          assignedEmployeeId: { in: employeeIds },
          status: { notIn: ["retired", "stolen"] },
        },
        _count: { _all: true },
      }),
    ]);

    const assigned = new Map<number, number>();
    for (const row of assignedRows) {
      if (row.assignedEmployeeId !== null) assigned.set(row.assignedEmployeeId, row._count._all);
    }
    const active = new Map<number, number>();
    for (const row of activeRows) {
      if (row.assignedEmployeeId !== null) active.set(row.assignedEmployeeId, row._count._all);
    }
    return { assigned, active };
  },

  async ticketCounts(employeeIds: number[], db: Db = prisma) {
    if (employeeIds.length === 0) return { total: new Map<number, number>(), open: new Map<number, number>() };

    const [totalRows, openRows] = await Promise.all([
      db.ticket.groupBy({
        by: ["employeeId"],
        where: { isDeleted: false, employeeId: { in: employeeIds } },
        _count: { _all: true },
      }),
      db.ticket.groupBy({
        by: ["employeeId"],
        where: {
          isDeleted: false,
          employeeId: { in: employeeIds },
          status: { in: ["open", "in_progress", "waiting"] },
        },
        _count: { _all: true },
      }),
    ]);

    const total = new Map<number, number>();
    for (const row of totalRows) if (row.employeeId !== null) total.set(row.employeeId, row._count._all);
    const open = new Map<number, number>();
    for (const row of openRows) if (row.employeeId !== null) open.set(row.employeeId, row._count._all);
    return { total, open };
  },

  // --- Data health (spec §5.11) -----------------------------------------

  /** Active employees with no asset assigned to them. */
  async withoutAssets(db: Db = prisma) {
    return db.employee.findMany({
      where: { ...notDeleted(), isActive: true, assets: { none: { isDeleted: false } } },
      select: { id: true, fullName: true, email: true, department: true, site: true, jobTitle: true },
      orderBy: { fullName: "asc" },
    });
  },

  /**
   * Employees whose name or email collides with another record. Duplicates are
   * detected in SQL rather than by pulling the whole table into memory.
   */
  async duplicateCandidates(db: Db = prisma) {
    const rows = await db.$queryRaw<
      { id: number; full_name: string; email: string; site: string; department: string; reason: string }[]
    >`
      SELECT e.id, e.full_name, e.email, e.site, e.department,
             CASE WHEN n.c > 1 THEN 'Same full name' ELSE 'Same local-part of email' END AS reason
      FROM core_employee e
      LEFT JOIN (
        SELECT lower(btrim(full_name)) AS k, count(*) AS c
        FROM core_employee WHERE is_deleted = false GROUP BY 1 HAVING count(*) > 1
      ) n ON n.k = lower(btrim(e.full_name))
      LEFT JOIN (
        SELECT lower(split_part(email, '@', 1)) AS k, count(*) AS c
        FROM core_employee WHERE is_deleted = false GROUP BY 1 HAVING count(*) > 1
      ) m ON m.k = lower(split_part(e.email, '@', 1))
      WHERE e.is_deleted = false AND (n.c > 1 OR m.c > 1)
      ORDER BY lower(btrim(e.full_name)), e.id
    `;
    return rows;
  },
};
