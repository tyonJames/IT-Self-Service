import { prisma, type Db } from "@/lib/db/prisma";

/**
 * Lookup tables: Country, Site, TicketCategory, EquipmentItemType.
 *
 * These are small, read constantly, and change rarely — every list method
 * selects only the columns a dropdown or a management table actually needs.
 */

export interface Choice {
  value: string;
  label: string;
}

export const lookupRepository = {
  // --- Countries ---------------------------------------------------------

  async listCountries(options: { activeOnly?: boolean } = {}, db: Db = prisma) {
    return db.country.findMany({
      where: options.activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  },

  /** The Next.js equivalent of `Country.as_choices()` (spec §3.2). */
  async countryChoices(db: Db = prisma): Promise<Choice[]> {
    const rows = await db.country.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { code: true, name: true },
    });
    return rows.map((r) => ({ value: r.code, label: r.name }));
  },

  async findCountryByCode(code: string, db: Db = prisma) {
    return db.country.findUnique({ where: { code } });
  },

  // --- Sites -------------------------------------------------------------

  async listSites(
    options: { country?: string; activeOnly?: boolean; search?: string } = {},
    db: Db = prisma,
  ) {
    return db.site.findMany({
      where: {
        ...(options.country ? { siteCountry: options.country } : {}),
        ...(options.activeOnly ? { isActive: true } : {}),
        ...(options.search
          ? {
              OR: [
                { name: { contains: options.search, mode: "insensitive" as const } },
                { code: { contains: options.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ siteCountry: "asc" }, { name: "asc" }],
    });
  },

  /** Powers GET /api/sites/?country=ZW — the cascading dropdown (spec §5.3). */
  async sitesForCountry(country: string, db: Db = prisma) {
    return db.site.findMany({
      where: { siteCountry: country, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    });
  },

  async findSiteById(id: number, db: Db = prisma) {
    return db.site.findUnique({ where: { id } });
  },

  /**
   * Asset counts per site, excluding retired and stolen — the `asset_count`
   * property from spec §3.3, done as one grouped query rather than N+1.
   */
  async siteAssetCounts(db: Db = prisma): Promise<Map<number, number>> {
    const rows = await db.asset.groupBy({
      by: ["assignedSiteId"],
      where: {
        isDeleted: false,
        assignedSiteId: { not: null },
        status: { notIn: ["retired", "stolen"] },
      },
      _count: { _all: true },
    });
    const map = new Map<number, number>();
    for (const row of rows) {
      if (row.assignedSiteId !== null) map.set(row.assignedSiteId, row._count._all);
    }
    return map;
  },

  // --- Ticket categories -------------------------------------------------

  async listTicketCategories(options: { activeOnly?: boolean } = {}, db: Db = prisma) {
    return db.ticketCategory.findMany({
      where: options.activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  },

  async ticketCategoryChoices(db: Db = prisma): Promise<Choice[]> {
    const rows = await db.ticketCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { slug: true, name: true },
    });
    return rows.map((r) => ({ value: r.slug, label: r.name }));
  },

  /**
   * slug → display name for *every* category, active or not: a ticket raised
   * under a category that has since been deactivated must still render its
   * proper label rather than a raw slug.
   */
  async ticketCategoryLabels(db: Db = prisma): Promise<Map<string, string>> {
    const rows = await db.ticketCategory.findMany({ select: { slug: true, name: true } });
    return new Map(rows.map((r) => [r.slug, r.name]));
  },

  // --- Equipment item types ---------------------------------------------

  async listEquipmentItemTypes(options: { activeOnly?: boolean } = {}, db: Db = prisma) {
    return db.equipmentItemType.findMany({
      where: options.activeOnly ? { isActive: true } : {},
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  },

  async equipmentItemTypeLabels(db: Db = prisma): Promise<Map<string, string>> {
    const rows = await db.equipmentItemType.findMany({ select: { slug: true, name: true } });
    return new Map(rows.map((r) => [r.slug, r.name]));
  },
};
