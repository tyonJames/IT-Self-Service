import type { AssetCategory, AssetStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db/prisma";
import { normaliseAssetTag } from "@/lib/domain/asset-tag";
import { normaliseCountryCode } from "@/lib/config/countries";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { softDeleteData } from "@/repositories/soft-delete";
import {
  ASSET_DOCUMENT_EXTENSIONS,
  buildStorageKey,
  validateUpload,
} from "@/lib/security/uploads";
import { storage } from "@/lib/storage";
import type { AppSession } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/permissions";

/**
 * Asset business logic.
 *
 * The important rule here is assignment exclusivity (spec §3.4): an asset
 * belongs to an employee *or* to a site, never both. The Django original did
 * this in a `post_save` signal; here it is an explicit normalisation step that
 * every write path calls, backed by a CHECK constraint in the database so that
 * even a hand-written SQL import cannot violate it.
 */

export class AssetValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "AssetValidationError";
  }
}

export interface AssetWriteInput {
  assetTag: string | null;
  category: AssetCategory;
  brand: string;
  model: string;
  serialNumber: string;
  status: AssetStatus;
  assignedEmployeeId: number | null;
  assignedSiteId: number | null;
  department: string;
  site: string;
  location: string;
  macAddress: string;
  osVersion: string;
  officeVersion: string;
  laptopOrDesktop: string;
  imei1: string;
  imei2: string;
  cellNumber: string;
  package: string;
  printerType: string;
  tonerType: string;
  ipAddress: string;
  areaCode: string;
  acquisitionDate: Date | null;
  notes: string;
}

export interface NormalisedAssignment {
  assignedEmployeeId: number | null;
  assignedSiteId: number | null;
  assignedToName: string;
  assignedToUserId: number | null;
  department: string;
  location: string;
  site: string;
}

/**
 * Resolve the denormalised assignment columns from whichever of employee/site
 * was supplied. The employee wins if both arrive — matching the Django save()
 * behaviour, which cleared `assigned_site` when an employee was present.
 */
export async function normaliseAssignment(
  input: {
    assignedEmployeeId: number | null;
    assignedSiteId: number | null;
    department: string;
    location: string;
    site: string;
  },
  db: Db = prisma,
): Promise<NormalisedAssignment> {
  if (input.assignedEmployeeId) {
    const employee = await db.employee.findFirst({
      where: { id: input.assignedEmployeeId, isDeleted: false },
      select: { id: true, fullName: true, userId: true, department: true, site: true },
    });
    if (!employee) {
      throw new AssetValidationError("That employee record no longer exists.", "assignedEmployeeId");
    }
    return {
      assignedEmployeeId: employee.id,
      assignedSiteId: null, // exclusivity
      assignedToName: employee.fullName,
      assignedToUserId: employee.userId,
      department: input.department || employee.department,
      location: input.location,
      site: normaliseCountryCode(input.site || employee.site),
    };
  }

  if (input.assignedSiteId) {
    const site = await db.site.findUnique({
      where: { id: input.assignedSiteId },
      select: { id: true, name: true, siteCountry: true },
    });
    if (!site) {
      throw new AssetValidationError("That site no longer exists.", "assignedSiteId");
    }
    return {
      assignedEmployeeId: null,
      assignedSiteId: site.id,
      assignedToName: site.name,
      assignedToUserId: null,
      department: input.department,
      location: input.location || site.name,
      site: normaliseCountryCode(input.site || site.siteCountry),
    };
  }

  return {
    assignedEmployeeId: null,
    assignedSiteId: null,
    assignedToName: "",
    assignedToUserId: null,
    department: input.department,
    location: input.location,
    site: normaliseCountryCode(input.site),
  };
}

function specFields(input: AssetWriteInput) {
  return {
    macAddress: input.macAddress,
    osVersion: input.osVersion,
    officeVersion: input.officeVersion,
    laptopOrDesktop: input.laptopOrDesktop,
    imei1: input.imei1,
    imei2: input.imei2,
    cellNumber: input.cellNumber,
    package: input.package,
    printerType: input.printerType,
    tonerType: input.tonerType,
    ipAddress: input.ipAddress,
    areaCode: input.areaCode,
  };
}

async function assertTagAvailable(tag: string | null, excludeId: number | null, db: Db): Promise<void> {
  if (!tag) return;
  const existing = await db.asset.findFirst({
    where: { assetTag: tag },
    select: { id: true, isDeleted: true },
  });
  if (existing && existing.id !== excludeId) {
    throw new AssetValidationError(
      existing.isDeleted
        ? `Asset tag ${tag} belongs to a record in the recycle bin. Restore or purge it first.`
        : `Asset tag ${tag} is already in use.`,
      "assetTag",
    );
  }
}

export const assetService = {
  async create(session: AppSession, input: AssetWriteInput): Promise<number> {
    const assetTag = normaliseAssetTag(input.assetTag);

    const asset = await prisma.$transaction(async (tx) => {
      await assertTagAvailable(assetTag, null, tx);
      const assignment = await normaliseAssignment(input, tx);

      return tx.asset.create({
        data: {
          assetTag,
          category: input.category,
          brand: input.brand,
          model: input.model,
          serialNumber: input.serialNumber,
          status: input.status,
          acquisitionDate: input.acquisitionDate,
          notes: input.notes,
          ...assignment,
          ...specFields(input),
        },
        select: { id: true, assetTag: true },
      });
    });

    await auditService.record({
      event: SecurityEvent.ASSET_CREATED,
      message: `Asset ${asset.assetTag ?? `#${asset.id}`} created`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Asset",
      targetId: asset.id,
      detail: { category: input.category, status: input.status, country: input.site },
    });

    return asset.id;
  },

  async update(session: AppSession, id: number, input: AssetWriteInput): Promise<void> {
    const assetTag = normaliseAssetTag(input.assetTag);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.asset.findFirst({ where: { id, isDeleted: false }, select: { id: true } });
      if (!existing) throw new ForbiddenError("That asset no longer exists.");

      await assertTagAvailable(assetTag, id, tx);
      const assignment = await normaliseAssignment(input, tx);

      await tx.asset.update({
        where: { id },
        data: {
          assetTag,
          category: input.category,
          brand: input.brand,
          model: input.model,
          serialNumber: input.serialNumber,
          status: input.status,
          acquisitionDate: input.acquisitionDate,
          notes: input.notes,
          ...assignment,
          ...specFields(input),
        },
      });
    });

    await auditService.record({
      event: SecurityEvent.ASSET_UPDATED,
      message: `Asset ${assetTag ?? `#${id}`} updated`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Asset",
      targetId: id,
    });
  },

  async softDelete(session: AppSession, id: number): Promise<void> {
    const asset = await prisma.asset.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, assetTag: true },
    });
    if (!asset) throw new ForbiddenError("That asset no longer exists.");

    await prisma.asset.update({ where: { id }, data: softDeleteData(session.user.id) });

    await auditService.record({
      event: SecurityEvent.ASSET_DELETED,
      message: `Asset ${asset.assetTag ?? `#${id}`} moved to the recycle bin`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Asset",
      targetId: id,
      level: "WARNING",
    });
  },

  // --- Documents ---------------------------------------------------------

  async addDocument(
    session: AppSession,
    assetId: number,
    file: File,
    documentType: "policy" | "allocation" | "other",
    notes: string,
  ): Promise<void> {
    const asset = await prisma.asset.findFirst({ where: { id: assetId, isDeleted: false }, select: { id: true } });
    if (!asset) throw new ForbiddenError("That asset no longer exists.");

    const validated = await validateUpload(file, { allowedExtensions: ASSET_DOCUMENT_EXTENSIONS });
    const key = buildStorageKey("asset_docs", assetId, validated.filename);
    await storage().put(key, validated.bytes, validated.contentType);

    await prisma.assetDocument.create({
      data: {
        assetId,
        documentType,
        storageKey: key,
        filename: validated.filename,
        contentType: validated.contentType,
        sizeBytes: validated.size,
        uploadedById: session.user.id,
        notes,
      },
    });

    await auditService.record({
      event: SecurityEvent.FILE_UPLOADED,
      message: `Document ${validated.filename} attached to asset #${assetId}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Asset",
      targetId: assetId,
      detail: { documentType },
    });
  },

  async deleteDocument(session: AppSession, documentId: bigint): Promise<number> {
    const doc = await prisma.assetDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new ForbiddenError("That document no longer exists.");

    await prisma.assetDocument.delete({ where: { id: documentId } });
    await storage().delete(doc.storageKey).catch(() => undefined);

    await auditService.record({
      event: SecurityEvent.FILE_DELETED,
      message: `Document ${doc.filename} deleted from asset #${doc.assetId}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "AssetDocument",
      targetId: documentId,
      level: "WARNING",
    });

    return doc.assetId;
  },

  /** Bulk-retire an employee's assets during offboarding (spec §5.9). */
  async retireAssetsForEmployee(tx: Db, employeeId: number): Promise<number> {
    const result = await tx.asset.updateMany({
      where: { assignedEmployeeId: employeeId, isDeleted: false, status: { notIn: ["retired", "stolen"] } },
      data: { status: "return_pending" },
    });
    return result.count;
  },

  /** Counts for the register's country tiles (spec §5.7). */
  async countryTiles(): Promise<{ code: string; count: number }[]> {
    const rows = await prisma.asset.groupBy({
      by: ["site"],
      where: { isDeleted: false, status: { notIn: ["retired", "stolen"] } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ code: r.site, count: r._count._all }));
  },

  async statusBreakdown(where: Prisma.AssetWhereInput = { isDeleted: false }) {
    const rows = await prisma.asset.groupBy({ by: ["status"], where, _count: { _all: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  },
};
