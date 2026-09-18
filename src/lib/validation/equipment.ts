import { z } from "zod";
import {
  checkboxField,
  emailField,
  honeypotField,
  longText,
  optionalIntId,
  optionalText,
  requiredText,
  ticketCountryField,
} from "./common";
import { EQUIPMENT_STATUSES } from "@/lib/domain/equipment-status";

const statusEnum = z.enum(EQUIPMENT_STATUSES as [string, ...string[]]);

/**
 * Public equipment request (spec §5.2).
 *
 * Items arrive as parallel arrays: `items[]` carries the slugs that were
 * ticked and `quantity_<slug>` carries each quantity. They are recombined and
 * validated against the active EquipmentItemType rows in the action, so a
 * hand-crafted POST cannot introduce an item type that does not exist.
 */
export const publicEquipmentRequestSchema = z.object({
  requesterName: requiredText("Your name", 120),
  requesterEmail: emailField(),
  department: optionalText(120),
  country: ticketCountryField(),
  siteName: optionalText(150),
  siteId: optionalIntId(),
  priority: z.enum(["normal", "urgent"]).catch("normal"),
  otherEquipment: optionalText(500),
  reason: requiredText("A short reason", 500),
  justification: longText("Justification", 5000, false),
  sendCopy: checkboxField(),
  website: honeypotField(),
});

export type PublicEquipmentRequestInput = z.infer<typeof publicEquipmentRequestSchema>;

export const equipmentDecisionSchema = z.object({
  requestId: z.coerce.number().int().positive(),
  status: statusEnum,
  note: optionalText(4000),
  issuedAssetIds: z
    .union([z.string(), z.array(z.string()), z.undefined()])
    .transform((v) => {
      const raw = v === undefined ? [] : Array.isArray(v) ? v : [v];
      return raw
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isSafeInteger(n) && n > 0);
    }),
});

export const equipmentFilterSchema = z.object({
  status: statusEnum.optional().catch(undefined),
  openness: z.enum(["open", "closed", "all"]).catch("open"),
  country: z.string().max(10).optional().catch(undefined),
  priority: z.enum(["normal", "urgent"]).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
});

/**
 * Parse the ticked item checkboxes plus their quantities out of the form.
 * Unknown slugs are dropped by the caller after checking the database.
 */
export function parseRequestedItems(formData: FormData): { item: string; quantity: number }[] {
  const slugs = formData
    .getAll("items")
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);

  return [...new Set(slugs)].map((slug) => {
    const raw = formData.get(`quantity_${slug}`);
    const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : 1;
    const quantity = Number.isFinite(parsed) ? Math.min(99, Math.max(1, parsed)) : 1;
    return { item: slug, quantity };
  });
}
