import { z } from "zod";
import { normaliseCountryCode } from "@/lib/config/countries";

/**
 * Shared Zod building blocks (instruction §17).
 *
 * Validation runs on the server for security and correctness; the same
 * constraints are mirrored as HTML attributes on the forms for immediate
 * feedback. The client copy is a convenience — this file is the authority.
 */

/** Collapse whitespace and trim. Applied before length checks. */
export const trimmed = z.string().transform((v) => v.replace(/\s+/g, " ").trim());

export const requiredText = (field: string, max = 255) =>
  trimmed.pipe(
    z
      .string()
      .min(1, `${field} is required.`)
      .max(max, `${field} must be ${max} characters or fewer.`),
  );

export const optionalText = (max = 255) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `Must be ${max} characters or fewer.`));

/** Multi-line text: trims, but keeps the user's line breaks. */
export const longText = (field: string, max = 20000, required = true) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").replace(/\r\n/g, "\n").trim())
    .pipe(
      required
        ? z.string().min(1, `${field} is required.`).max(max, `${field} is too long.`)
        : z.string().max(max, `${field} is too long.`),
    );

export const emailField = (field = "Email address") =>
  z
    .string({ required_error: `${field} is required.` })
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().min(1, `${field} is required.`).email(`Enter a valid ${field.toLowerCase()}.`).max(254));

export const optionalEmailField = () =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim().toLowerCase())
    .pipe(z.union([z.literal(""), z.string().email("Enter a valid email address.").max(254)]));

/** Any country code the UI might send; always normalised to ZW/MZ/GR/NA (CC-003). */
export const countryField = (fallback = "ZW") =>
  z
    .string()
    .optional()
    .transform((v) => normaliseCountryCode(v, fallback));

/** Country field that also permits OTHER, for tickets and equipment requests. */
export const ticketCountryField = () =>
  z
    .string()
    .optional()
    .transform((v) => {
      const raw = (v ?? "").trim().toUpperCase();
      if (raw === "OTHER") return "OTHER";
      return normaliseCountryCode(raw, "ZW");
    });

/** Checkbox: present in FormData means checked. */
export const checkboxField = () =>
  z
    .union([z.string(), z.boolean(), z.undefined()])
    .transform((v) => v === true || v === "on" || v === "true" || v === "1" || v === "yes");

export const optionalIntId = () =>
  z
    .union([z.string(), z.number(), z.undefined(), z.null()])
    .transform((v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = typeof v === "number" ? v : Number.parseInt(v, 10);
      return Number.isSafeInteger(n) && n > 0 ? n : null;
    });

export const requiredIntId = (field = "Identifier") =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : Number.parseInt(v, 10)))
    .pipe(z.number().int().positive(`${field} is invalid.`));

export const positiveQuantity = () =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : Number.parseInt(v, 10)))
    .pipe(z.number().int().min(1, "Quantity must be at least 1.").max(999, "Quantity is too large."));

export const optionalDateField = () =>
  z
    .string()
    .optional()
    .transform((v) => {
      const raw = (v ?? "").trim();
      if (!raw) return null;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    });

/** A slug for a lookup table: lower-case, alphanumeric and underscores. */
export const slugField = (field = "Slug") =>
  z
    .string()
    .transform((v) => v.trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .pipe(
      z
        .string()
        .min(1, `${field} is required.`)
        .max(60)
        .regex(/^[a-z0-9_]+$/, `${field} may contain only lowercase letters, numbers and underscores.`),
    );

export const sortOrderField = () =>
  z
    .union([z.string(), z.number(), z.undefined()])
    .transform((v) => {
      if (v === undefined || v === "") return 0;
      const n = typeof v === "number" ? v : Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    })
    .pipe(z.number().int().min(0).max(100000));

/**
 * Honeypot: a field real users never fill in because it is hidden. Anything
 * in it means a bot, which the public forms reject silently.
 */
export const honeypotField = () =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim())
    .pipe(z.literal("", { errorMap: () => ({ message: "Submission rejected." }) }));

/** Turn a FormData into a plain object Zod can parse, keeping repeated keys as arrays. */
export function formDataToObject(formData: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) continue; // files are handled separately
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

/** All non-empty files submitted under one field name. */
export function filesFromFormData(formData: FormData, field: string): File[] {
  return formData
    .getAll(field)
    .filter((v): v is File => v instanceof File && v.size > 0);
}
