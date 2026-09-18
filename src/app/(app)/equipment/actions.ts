"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EquipmentStatus } from "@prisma/client";
import { equipmentService } from "@/services/equipment.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { requireAgent, ForbiddenError } from "@/lib/permissions";
import { equipmentDecisionSchema } from "@/lib/validation/equipment";
import { formDataToObject } from "@/lib/validation/common";
import { InvalidTransitionError } from "@/lib/domain/equipment-status";
import { errorState, successState, zodErrorState, type FormState } from "@/lib/utils/result";
import { logger } from "@/lib/logging/logger";

/**
 * Equipment request actions.
 *
 * `applyStatus` is where the state machine is enforced. An invalid transition
 * raises `InvalidTransitionError`, which surfaces to the user as a clear
 * message rather than a 500 — a stale tab is a normal thing to happen, not a
 * crash (instruction §7).
 */
export async function decideEquipmentRequest(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const raw = formDataToObject(formData);
    // Multi-select values need collecting before the object conversion drops them.
    const issuedAssetIds = formData.getAll("issuedAssetIds").map(String);

    const parsed = equipmentDecisionSchema.safeParse({ ...raw, issuedAssetIds });
    if (!parsed.success) return zodErrorState(parsed.error);

    await equipmentService.applyStatus(
      session,
      parsed.data.requestId,
      parsed.data.status as EquipmentStatus,
      parsed.data.note,
      parsed.data.issuedAssetIds,
    );

    revalidatePath(`/equipment/${parsed.data.requestId}/`);
    revalidatePath("/equipment/");
    return successState("Updated, and the requester has been emailed.");
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return errorState(
        `${error.message} Someone may have already moved this request — reload the page to see where it is now.`,
      );
    }
    if (error instanceof CsrfError) return errorState(error.message);
    if (error instanceof ForbiddenError) return errorState(error.message);
    if (typeof error === "object" && error !== null && "digest" in error) throw error;

    logger().error({ err: (error as Error).message }, "Equipment decision failed");
    return errorState("Something went wrong. The problem has been logged — please try again.");
  }
}

export async function deleteEquipmentRequest(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const requestId = Number.parseInt(String(formData.get("requestId") ?? ""), 10);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    throw new ForbiddenError("That request could not be found.");
  }

  await equipmentService.softDelete(session, requestId);

  revalidatePath("/equipment/");
  revalidatePath("/manage/recycle-bin/");
  redirect("/equipment/?deleted=1");
}
