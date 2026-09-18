"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assetService, AssetValidationError } from "@/services/asset.service";
import { deviceService } from "@/services/device.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { requireAgent, ForbiddenError } from "@/lib/permissions";
import {
  assetDocumentSchema,
  assetWriteSchema,
  manualLocationSchema,
} from "@/lib/validation/assets";
import { filesFromFormData, formDataToObject } from "@/lib/validation/common";
import { errorState, successState, zodErrorState, type FormState } from "@/lib/utils/result";
import { UploadRejectedError } from "@/lib/security/uploads";
import { logger } from "@/lib/logging/logger";
import type { AssetCategory, AssetStatus } from "@prisma/client";

/** Asset Server Actions. Every one re-checks the session and the role. */

function toFormState(error: unknown, context: string): FormState {
  if (error instanceof CsrfError) return errorState(error.message);
  if (error instanceof ForbiddenError) return errorState(error.message);
  if (error instanceof UploadRejectedError) return errorState(error.message);
  if (error instanceof AssetValidationError) {
    return errorState(error.message, error.field ? { [error.field]: [error.message] } : undefined);
  }
  if (typeof error === "object" && error !== null && "digest" in error) throw error;

  logger().error({ context, err: (error as Error).message }, "Asset action failed");
  return errorState("Something went wrong. The problem has been logged — please try again.");
}

export async function createAsset(_previous: FormState, formData: FormData): Promise<FormState> {
  let newId: number;
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = assetWriteSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    newId = await assetService.create(session, {
      ...parsed.data,
      category: parsed.data.category as AssetCategory,
      status: parsed.data.status as AssetStatus,
    });

    revalidatePath("/assets/");
  } catch (error) {
    return toFormState(error, "createAsset");
  }

  redirect(`/assets/${newId}/?created=1`);
}

export async function updateAsset(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const assetId = Number.parseInt(String(formData.get("assetId") ?? ""), 10);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) {
      return errorState("That asset could not be found.");
    }

    const parsed = assetWriteSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await assetService.update(session, assetId, {
      ...parsed.data,
      category: parsed.data.category as AssetCategory,
      status: parsed.data.status as AssetStatus,
    });

    revalidatePath(`/assets/${assetId}/`);
    revalidatePath("/assets/");
    return successState("Asset updated.");
  } catch (error) {
    return toFormState(error, "updateAsset");
  }
}

export async function deleteAsset(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const assetId = Number.parseInt(String(formData.get("assetId") ?? ""), 10);
  if (!Number.isSafeInteger(assetId) || assetId <= 0) {
    throw new ForbiddenError("That asset could not be found.");
  }

  await assetService.softDelete(session, assetId);

  revalidatePath("/assets/");
  revalidatePath("/manage/recycle-bin/");
  redirect("/assets/?deleted=1");
}

export async function uploadAssetDocument(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = assetDocumentSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const [file] = filesFromFormData(formData, "document");
    if (!file) return errorState("Choose a file to upload.");

    await assetService.addDocument(
      session,
      parsed.data.assetId,
      file,
      parsed.data.documentType,
      parsed.data.notes,
    );

    revalidatePath(`/assets/${parsed.data.assetId}/`);
    return successState("Document uploaded.");
  } catch (error) {
    return toFormState(error, "uploadAssetDocument");
  }
}

export async function deleteAssetDocument(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const documentId = BigInt(String(formData.get("documentId") ?? "0"));
  if (documentId <= 0n) throw new ForbiddenError("That document could not be found.");

  const assetId = await assetService.deleteDocument(session, documentId);
  revalidatePath(`/assets/${assetId}/`);
}

/**
 * Rotate the device key (spec §5.16).
 *
 * The new key is returned once, here, and never stored in recoverable form —
 * so it is handed back through the form state for the agent to copy into the
 * PowerShell agent's config, and never rendered again on a later page load.
 */
export async function rotateDeviceKey(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const assetId = Number.parseInt(String(formData.get("assetId") ?? ""), 10);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) {
      return errorState("That asset could not be found.");
    }

    const deviceKey = await deviceService.rotateKey(session, assetId);

    revalidatePath(`/assets/${assetId}/`);
    return successState(
      "New device key issued. Copy it now — it cannot be shown again, and the previous key has already stopped working.",
      { deviceKey },
    );
  } catch (error) {
    return toFormState(error, "rotateDeviceKey");
  }
}

export async function disableTracking(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const assetId = Number.parseInt(String(formData.get("assetId") ?? ""), 10);
  if (!Number.isSafeInteger(assetId) || assetId <= 0) {
    throw new ForbiddenError("That asset could not be found.");
  }

  await deviceService.disableTracking(session, assetId);
  revalidatePath(`/assets/${assetId}/`);
}

export async function recordManualLocation(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = manualLocationSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await deviceService.recordManualLocation(session, parsed.data.assetId, {
      city: parsed.data.city,
      region: parsed.data.region,
      country: parsed.data.country,
      notes: parsed.data.notes,
    });

    revalidatePath(`/assets/${parsed.data.assetId}/`);
    return successState("Location recorded.");
  } catch (error) {
    return toFormState(error, "recordManualLocation");
  }
}
