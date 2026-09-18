import { z } from "zod";
import {
  checkboxField,
  countryField,
  emailField,
  optionalEmailField,
  optionalIntId,
  optionalText,
  requiredText,
} from "./common";

/** Employee create/update (spec §3.7). */
export const employeeWriteSchema = z.object({
  fullName: requiredText("Full name", 150),
  email: emailField(),
  phone: optionalText(40),
  department: optionalText(120),
  jobTitle: optionalText(120),
  site: countryField(),
  // Blank must become NULL, not '', for the unique index (same rule as asset tags).
  employeeNumber: z
    .string()
    .optional()
    .transform((v) => {
      const trimmed = (v ?? "").trim();
      return trimmed === "" ? null : trimmed.slice(0, 40);
    }),
  staffGroup: z.enum(["staff", "management", "consultant"]).catch("staff"),
  altEmail: optionalEmailField(),
  isActive: checkboxField(),
  notes: optionalText(4000),
  userId: optionalIntId(),
});

export type EmployeeWriteForm = z.infer<typeof employeeWriteSchema>;

export const employeeFilterSchema = z.object({
  country: z.string().max(10).optional().catch(undefined),
  department: z.string().max(120).optional().catch(undefined),
  staffGroup: z.enum(["staff", "management", "consultant"]).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  view: z.enum(["grid", "table"]).catch("table"),
  group: z.enum(["country", "department", "staffGroup", "none"]).catch("none"),
});

/**
 * Temporary mailbox password (spec §3.7).
 *
 * Deliberately not run through the login password policy: this is a password
 * IT sets on a Microsoft 365 mailbox for a new starter, not a password for
 * this application, and M365's own policy governs it. A minimum length is
 * still enforced so an empty string cannot be stored as if it were a secret.
 */
export const temporaryPasswordSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  password: z
    .string()
    .min(8, "A temporary password should be at least 8 characters.")
    .max(128, "That is too long to be a mailbox password."),
});

export const employeeIdSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
});
