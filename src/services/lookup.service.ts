import { prisma } from "@/lib/db/prisma";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { ForbiddenError } from "@/lib/permissions";
import type { AppSession } from "@/lib/auth/session";

/**
 * CRUD for the four lookup tables (spec §5.14).
 *
 * Two rules run through all of them:
 *  - A slug or code, once used, is immutable. Tickets store category slugs and
 *    assets store country codes as plain strings; renaming one would orphan
 *    every historic record that referenced it (spec §3.8).
 *  - Deactivating hides a value from new records but leaves history intact.
 *    Deleting is only allowed when nothing references the row at all.
 */

export class LookupValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "LookupValidationError";
  }
}

export const lookupService = {
  // --- Sites -------------------------------------------------------------

  async createSite(
    session: AppSession,
    input: { name: string; code: string; siteCountry: string; address: string; notes: string },
  ): Promise<void> {
    const clash = await prisma.site.findFirst({
      where: { name: input.name, siteCountry: input.siteCountry },
      select: { id: true },
    });
    if (clash) {
      throw new LookupValidationError(
        `There is already a site called “${input.name}” in that country.`,
        "name",
      );
    }

    await prisma.site.create({ data: { ...input, isActive: true } });
    await auditService.record({
      event: SecurityEvent.ASSET_CREATED,
      message: `Site ${input.name} created`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Site",
    });
  },

  async updateSite(
    session: AppSession,
    id: number,
    input: {
      name: string;
      code: string;
      siteCountry: string;
      address: string;
      notes: string;
      isActive: boolean;
    },
  ): Promise<void> {
    const clash = await prisma.site.findFirst({
      where: { name: input.name, siteCountry: input.siteCountry, NOT: { id } },
      select: { id: true },
    });
    if (clash) {
      throw new LookupValidationError(
        `There is already a site called “${input.name}” in that country.`,
        "name",
      );
    }

    await prisma.site.update({ where: { id }, data: input });
    await auditService.record({
      event: SecurityEvent.ASSET_UPDATED,
      message: `Site ${input.name} updated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Site",
      targetId: id,
    });
  },

  /** Only a site with nothing attached to it can be deleted (spec §5.14). */
  async deleteSite(session: AppSession, id: number): Promise<void> {
    const site = await prisma.site.findUnique({
      where: { id },
      select: {
        name: true,
        isActive: true,
        _count: { select: { assets: true, equipmentRequests: true } },
      },
    });
    if (!site) throw new ForbiddenError("That site no longer exists.");

    if (site.isActive) {
      throw new LookupValidationError("Deactivate the site before deleting it.");
    }
    if (site._count.assets > 0 || site._count.equipmentRequests > 0) {
      throw new LookupValidationError(
        `“${site.name}” still has ${site._count.assets} asset(s) and ${site._count.equipmentRequests} request(s) attached. Reassign them first.`,
      );
    }

    await prisma.site.delete({ where: { id } });
    await auditService.record({
      event: SecurityEvent.RECORD_PURGED,
      message: `Site ${site.name} deleted`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Site",
      targetId: id,
      level: "WARNING",
    });
  },

  // --- Ticket categories -------------------------------------------------

  async createTicketCategory(
    session: AppSession,
    input: { name: string; slug: string; sortOrder: number },
  ): Promise<void> {
    const clash = await prisma.ticketCategory.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (clash) throw new LookupValidationError("That slug is already in use.", "slug");

    await prisma.ticketCategory.create({ data: { ...input, isActive: true } });
    await auditService.record({
      event: SecurityEvent.ASSET_CREATED,
      message: `Ticket category ${input.name} (${input.slug}) created`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "TicketCategory",
    });
  },

  /** The slug is deliberately not updatable — tickets store it (spec §3.8). */
  async updateTicketCategory(
    session: AppSession,
    id: number,
    input: { name: string; sortOrder: number; isActive: boolean },
  ): Promise<void> {
    await prisma.ticketCategory.update({ where: { id }, data: input });
    await auditService.record({
      event: SecurityEvent.ASSET_UPDATED,
      message: `Ticket category ${input.name} updated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "TicketCategory",
      targetId: id,
    });
  },

  async deleteTicketCategory(session: AppSession, id: number): Promise<void> {
    const category = await prisma.ticketCategory.findUnique({
      where: { id },
      select: { slug: true, name: true, isActive: true },
    });
    if (!category) throw new ForbiddenError("That category no longer exists.");
    if (category.isActive) {
      throw new LookupValidationError("Deactivate the category before deleting it.");
    }

    const used = await prisma.ticket.count({ where: { category: category.slug } });
    if (used > 0) {
      throw new LookupValidationError(
        `${used} ticket(s) still use “${category.name}”. Leave it deactivated instead — deleting it would leave those tickets without a label.`,
      );
    }

    await prisma.ticketCategory.delete({ where: { id } });
    await auditService.record({
      event: SecurityEvent.RECORD_PURGED,
      message: `Ticket category ${category.name} deleted`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "TicketCategory",
      targetId: id,
      level: "WARNING",
    });
  },

  // --- Equipment item types ---------------------------------------------

  async createEquipmentType(
    session: AppSession,
    input: { name: string; slug: string; sortOrder: number },
  ): Promise<void> {
    const clash = await prisma.equipmentItemType.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (clash) throw new LookupValidationError("That slug is already in use.", "slug");

    await prisma.equipmentItemType.create({ data: { ...input, isActive: true } });
    await auditService.record({
      event: SecurityEvent.ASSET_CREATED,
      message: `Equipment type ${input.name} (${input.slug}) created`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "EquipmentItemType",
    });
  },

  async updateEquipmentType(
    session: AppSession,
    id: number,
    input: { name: string; sortOrder: number; isActive: boolean },
  ): Promise<void> {
    await prisma.equipmentItemType.update({ where: { id }, data: input });
    await auditService.record({
      event: SecurityEvent.ASSET_UPDATED,
      message: `Equipment type ${input.name} updated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "EquipmentItemType",
      targetId: id,
    });
  },

  async deleteEquipmentType(session: AppSession, id: number): Promise<void> {
    const type = await prisma.equipmentItemType.findUnique({
      where: { id },
      select: { slug: true, name: true, isActive: true },
    });
    if (!type) throw new ForbiddenError("That equipment type no longer exists.");
    if (type.isActive) {
      throw new LookupValidationError("Deactivate the equipment type before deleting it.");
    }

    const used = await prisma.requestedItem.count({ where: { item: type.slug } });
    if (used > 0) {
      throw new LookupValidationError(
        `${used} request line(s) still use “${type.name}”. Leave it deactivated instead.`,
      );
    }

    await prisma.equipmentItemType.delete({ where: { id } });
    await auditService.record({
      event: SecurityEvent.RECORD_PURGED,
      message: `Equipment type ${type.name} deleted`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "EquipmentItemType",
      targetId: id,
      level: "WARNING",
    });
  },

  // --- Countries ---------------------------------------------------------

  async createCountry(
    session: AppSession,
    input: { code: string; name: string; sortOrder: number },
  ): Promise<void> {
    const code = input.code.trim().toUpperCase();
    const clash = await prisma.country.findUnique({ where: { code }, select: { id: true } });
    if (clash) throw new LookupValidationError("That country code already exists.", "code");

    await prisma.country.create({ data: { ...input, code, isActive: true } });
    await auditService.record({
      event: SecurityEvent.ASSET_CREATED,
      message: `Country ${code} (${input.name}) created`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Country",
    });
  },

  /** The code is immutable — assets, employees and tickets store it as a string. */
  async updateCountry(
    session: AppSession,
    id: number,
    input: { name: string; sortOrder: number; isActive: boolean },
  ): Promise<void> {
    await prisma.country.update({ where: { id }, data: input });
    await auditService.record({
      event: SecurityEvent.ASSET_UPDATED,
      message: `Country ${input.name} updated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Country",
      targetId: id,
    });
  },

  async deleteCountry(session: AppSession, id: number): Promise<void> {
    const country = await prisma.country.findUnique({
      where: { id },
      select: { code: true, name: true, isActive: true },
    });
    if (!country) throw new ForbiddenError("That country no longer exists.");
    if (country.isActive) {
      throw new LookupValidationError("Deactivate the country before deleting it.");
    }

    const [assets, employees, tickets, sites] = await Promise.all([
      prisma.asset.count({ where: { site: country.code } }),
      prisma.employee.count({ where: { site: country.code } }),
      prisma.ticket.count({ where: { country: country.code } }),
      prisma.site.count({ where: { siteCountry: country.code } }),
    ]);

    const total = assets + employees + tickets + sites;
    if (total > 0) {
      throw new LookupValidationError(
        `“${country.name}” is still referenced by ${assets} asset(s), ${employees} employee(s), ${tickets} ticket(s) and ${sites} site(s). Leave it deactivated instead.`,
      );
    }

    await prisma.country.delete({ where: { id } });
    await auditService.record({
      event: SecurityEvent.RECORD_PURGED,
      message: `Country ${country.name} deleted`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Country",
      targetId: id,
      level: "WARNING",
    });
  },
};
