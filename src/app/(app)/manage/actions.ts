"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lookupService, LookupValidationError } from "@/services/lookup.service";
import { recycleBinService, type RecycleTab } from "@/services/recyclebin.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { requireAdmin, requireAgent, ForbiddenError } from "@/lib/permissions";
import {
  checkboxField,
  countryField,
  optionalText,
  requiredText,
  slugField,
  sortOrderField,
} from "@/lib/validation/common";
import { formDataToObject } from "@/lib/validation/common";
import { errorState, successState, zodErrorState, type FormState } from "@/lib/utils/result";
import { logger } from "@/lib/logging/logger";

/** Management-page actions for the lookup tables and the recycle bin. */

function toFormState(error: unknown, context: string): FormState {
  if (error instanceof CsrfError) return errorState(error.message);
  if (error instanceof ForbiddenError) return errorState(error.message);
  if (error instanceof LookupValidationError) {
    return errorState(error.message, error.field ? { [error.field]: [error.message] } : undefined);
  }
  if (typeof error === "object" && error !== null && "digest" in error) throw error;

  logger().error({ context, err: (error as Error).message }, "Management action failed");
  return errorState("Something went wrong. The problem has been logged — please try again.");
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

const siteSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: requiredText("Site name", 150),
  code: optionalText(30),
  siteCountry: countryField(),
  address: optionalText(250),
  notes: optionalText(1000),
  isActive: checkboxField(),
});

export async function saveSite(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = siteSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const { id, ...data } = parsed.data;

    if (id) {
      await lookupService.updateSite(session, id, data);
    } else {
      await lookupService.createSite(session, {
        name: data.name,
        code: data.code,
        siteCountry: data.siteCountry,
        address: data.address,
        notes: data.notes,
      });
    }

    revalidatePath("/manage/sites/");
    return successState(id ? "Site updated." : "Site added.");
  } catch (error) {
    return toFormState(error, "saveSite");
  }
}

export async function deleteSite(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ForbiddenError("That site could not be found.");

  await lookupService.deleteSite(session, id);
  revalidatePath("/manage/sites/");
}

// ---------------------------------------------------------------------------
// Ticket categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: requiredText("Category name", 120),
  slug: slugField("Slug").optional(),
  sortOrder: sortOrderField(),
  isActive: checkboxField(),
});

export async function saveTicketCategory(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = categorySchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const { id, name, slug, sortOrder, isActive } = parsed.data;

    if (id) {
      await lookupService.updateTicketCategory(session, id, { name, sortOrder, isActive });
    } else {
      if (!slug) {
        return errorState("A slug is required for a new category.", {
          slug: ["Enter a slug, e.g. hardware."],
        });
      }
      await lookupService.createTicketCategory(session, { name, slug, sortOrder });
    }

    revalidatePath("/manage/categories/");
    return successState(id ? "Category updated." : "Category added.");
  } catch (error) {
    return toFormState(error, "saveTicketCategory");
  }
}

export async function deleteTicketCategory(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ForbiddenError("Not found.");

  await lookupService.deleteTicketCategory(session, id);
  revalidatePath("/manage/categories/");
}

// ---------------------------------------------------------------------------
// Equipment item types
// ---------------------------------------------------------------------------

export async function saveEquipmentType(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = categorySchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const { id, name, slug, sortOrder, isActive } = parsed.data;

    if (id) {
      await lookupService.updateEquipmentType(session, id, { name, sortOrder, isActive });
    } else {
      if (!slug) {
        return errorState("A slug is required for a new equipment type.", {
          slug: ["Enter a slug, e.g. laptop_bag."],
        });
      }
      await lookupService.createEquipmentType(session, { name, slug, sortOrder });
    }

    revalidatePath("/manage/equipment-types/");
    return successState(id ? "Equipment type updated." : "Equipment type added.");
  } catch (error) {
    return toFormState(error, "saveEquipmentType");
  }
}

export async function deleteEquipmentType(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ForbiddenError("Not found.");

  await lookupService.deleteEquipmentType(session, id);
  revalidatePath("/manage/equipment-types/");
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

const countrySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  code: z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim().toUpperCase())
    .pipe(z.string().max(10)),
  name: requiredText("Country name", 120),
  sortOrder: sortOrderField(),
  isActive: checkboxField(),
});

export async function saveCountry(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = countrySchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const { id, code, name, sortOrder, isActive } = parsed.data;

    if (id) {
      await lookupService.updateCountry(session, id, { name, sortOrder, isActive });
    } else {
      if (!code || !/^[A-Z]{2,5}$/.test(code)) {
        return errorState("A country code of 2–5 letters is required.", {
          code: ["Enter a code such as ZW."],
        });
      }
      await lookupService.createCountry(session, { code, name, sortOrder });
    }

    revalidatePath("/manage/countries/");
    return successState(id ? "Country updated." : "Country added.");
  } catch (error) {
    return toFormState(error, "saveCountry");
  }
}

export async function deleteCountry(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ForbiddenError("Not found.");

  await lookupService.deleteCountry(session, id);
  revalidatePath("/manage/countries/");
}

// ---------------------------------------------------------------------------
// Recycle bin
// ---------------------------------------------------------------------------

const TABS: RecycleTab[] = ["assets", "employees", "tickets", "equipment"];

function parseRecycleForm(formData: FormData): { tab: RecycleTab; id: number } {
  const tab = String(formData.get("tab") ?? "") as RecycleTab;
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!TABS.includes(tab) || !Number.isSafeInteger(id) || id <= 0) {
    throw new ForbiddenError("That record could not be found.");
  }
  return { tab, id };
}

export async function restoreRecord(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();
  const { tab, id } = parseRecycleForm(formData);

  await recycleBinService.restore(session, tab, id);

  revalidatePath("/manage/recycle-bin/");
  revalidatePath(`/${tab === "equipment" ? "equipment" : tab}/`);
}

/** Purging is permanent, so it is admin-only (instruction §22). */
export async function purgeRecord(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAdmin();
  const { tab, id } = parseRecycleForm(formData);

  await recycleBinService.purge(session, tab, id);

  revalidatePath("/manage/recycle-bin/");
}
