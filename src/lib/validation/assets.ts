import { z } from "zod";
import {
  countryField,
  optionalDateField,
  optionalIntId,
  optionalText,
  requiredText,
} from "./common";
import { ALL_ASSET_CATEGORIES, ASSET_STATUSES } from "@/lib/domain/assets";
import { normaliseAssetTag } from "@/lib/domain/asset-tag";

const categoryEnum = z.enum(ALL_ASSET_CATEGORIES as [string, ...string[]]);
const statusEnum = z.enum(ASSET_STATUSES as [string, ...string[]]);

/**
 * Asset create/update (spec §3.4).
 *
 * The tag is normalised to upper case and blank becomes `null`, never `''`,
 * because the unique index must permit many untagged assets (spec note 6).
 * A MAC address is accepted in any common separator style and stored
 * canonically, so two spellings of the same card cannot look like two cards.
 */
const assetTagField = z
  .string()
  .optional()
  .transform((v) => normaliseAssetTag(v ?? null))
  .pipe(
    z
      .string()
      .max(40, "An asset tag is at most 40 characters.")
      .nullable(),
  );

const macAddressField = z
  .string()
  .optional()
  .transform((v) => {
    const cleaned = (v ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    if (cleaned.length !== 12) return (v ?? "").trim();
    return cleaned.match(/.{2}/g)?.join(":") ?? cleaned;
  })
  .pipe(z.string().max(40));

export const assetWriteSchema = z
  .object({
    assetTag: assetTagField,
    category: categoryEnum,
    brand: optionalText(80),
    model: optionalText(80),
    serialNumber: optionalText(120),
    status: statusEnum,

    assignedEmployeeId: optionalIntId(),
    assignedSiteId: optionalIntId(),
    department: optionalText(120),
    site: countryField(),
    location: optionalText(150),

    macAddress: macAddressField,
    osVersion: optionalText(80),
    officeVersion: optionalText(80),
    laptopOrDesktop: optionalText(40),
    imei1: optionalText(40),
    imei2: optionalText(40),
    cellNumber: optionalText(40),
    package: optionalText(80),
    printerType: optionalText(80),
    tonerType: optionalText(80),
    ipAddress: optionalText(60),
    areaCode: optionalText(40),

    acquisitionDate: optionalDateField(),
    notes: optionalText(4000),
  })
  .superRefine((value, ctx) => {
    // Spec §3.4: assignment is mutually exclusive.
    if (value.assignedEmployeeId && value.assignedSiteId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignedSiteId"],
        message: "An asset belongs to a person or to a site, not both. Clear one of them.",
      });
    }
  });

export type AssetWriteForm = z.infer<typeof assetWriteSchema>;

export const assetFilterSchema = z.object({
  category: categoryEnum.optional().catch(undefined),
  status: statusEnum.optional().catch(undefined),
  country: z.string().max(10).optional().catch(undefined),
  location: z.string().max(150).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  view: z.enum(["grid", "table"]).catch("table"),
  sort: z.enum(["assetTag", "category", "status", "brand", "createdAt", "lastSeenAt"]).catch("assetTag"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  unassigned: z.enum(["1", "0"]).optional().catch(undefined),
  tracking: z.enum(["1", "0"]).optional().catch(undefined),
});

export const assetDocumentSchema = z.object({
  assetId: z.coerce.number().int().positive(),
  documentType: z.enum(["policy", "allocation", "other"]).catch("other"),
  notes: optionalText(500),
});

export const manualLocationSchema = z.object({
  assetId: z.coerce.number().int().positive(),
  city: optionalText(120),
  region: optionalText(120),
  country: optionalText(120),
  notes: optionalText(500),
});

export const assetImportSchema = z.object({
  mode: z.enum(["create", "upsert"]).catch("upsert"),
  dryRun: z
    .union([z.string(), z.boolean(), z.undefined()])
    .transform((v) => v === true || v === "on" || v === "true" || v === "1"),
});

/** Required to identify an asset on a delete/rotate action. */
export const assetIdSchema = z.object({
  assetId: requiredText("Asset id").pipe(
    z.string().regex(/^\d+$/, "Asset id is invalid.").transform(Number),
  ),
});
