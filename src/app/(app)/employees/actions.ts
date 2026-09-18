"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { employeeService, EmployeeValidationError } from "@/services/employee.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { requireAgent, ForbiddenError } from "@/lib/permissions";
import { clientIp } from "@/lib/security/request";
import {
  employeeIdSchema,
  employeeWriteSchema,
  temporaryPasswordSchema,
} from "@/lib/validation/employees";
import { formDataToObject } from "@/lib/validation/common";
import { errorState, successState, zodErrorState, type FormState } from "@/lib/utils/result";
import { logger } from "@/lib/logging/logger";
import type { StaffGroup } from "@prisma/client";

function toFormState(error: unknown, context: string): FormState {
  if (error instanceof CsrfError) return errorState(error.message);
  if (error instanceof ForbiddenError) return errorState(error.message);
  if (error instanceof EmployeeValidationError) {
    return errorState(error.message, error.field ? { [error.field]: [error.message] } : undefined);
  }
  if (typeof error === "object" && error !== null && "digest" in error) throw error;

  logger().error({ context, err: (error as Error).message }, "Employee action failed");
  return errorState("Something went wrong. The problem has been logged — please try again.");
}

export async function createEmployee(_previous: FormState, formData: FormData): Promise<FormState> {
  let newId: number;
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = employeeWriteSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    newId = await employeeService.create(session, {
      ...parsed.data,
      staffGroup: parsed.data.staffGroup as StaffGroup,
    });

    revalidatePath("/employees/");
  } catch (error) {
    return toFormState(error, "createEmployee");
  }

  redirect(`/employees/${newId}/?created=1`);
}

export async function updateEmployee(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const employeeId = Number.parseInt(String(formData.get("employeeId") ?? ""), 10);
    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
      return errorState("That employee could not be found.");
    }

    const parsed = employeeWriteSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await employeeService.update(session, employeeId, {
      ...parsed.data,
      staffGroup: parsed.data.staffGroup as StaffGroup,
    });

    revalidatePath(`/employees/${employeeId}/`);
    revalidatePath("/employees/");
    return successState("Employee updated.");
  } catch (error) {
    return toFormState(error, "updateEmployee");
  }
}

export async function deleteEmployee(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const parsed = employeeIdSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) throw new ForbiddenError("That employee could not be found.");

  await employeeService.softDelete(session, parsed.data.employeeId);

  revalidatePath("/employees/");
  revalidatePath("/manage/recycle-bin/");
  redirect("/employees/?deleted=1");
}

/** Offboard: deactivate, mark devices return-pending, clear the stored password. */
export async function offboardEmployee(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const parsed = employeeIdSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) throw new ForbiddenError("That employee could not be found.");

  await employeeService.offboard(session, parsed.data.employeeId);

  revalidatePath(`/employees/${parsed.data.employeeId}/`);
  revalidatePath("/employees/");
  revalidatePath("/assets/");
}

export async function reactivateEmployee(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const parsed = employeeIdSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) throw new ForbiddenError("That employee could not be found.");

  await employeeService.reactivate(session, parsed.data.employeeId);

  revalidatePath(`/employees/${parsed.data.employeeId}/`);
  revalidatePath("/employees/");
}

export async function setTemporaryPassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = temporaryPasswordSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await employeeService.setTemporaryPassword(session, parsed.data.employeeId, parsed.data.password);

    revalidatePath(`/employees/${parsed.data.employeeId}/`);
    return successState("Temporary password stored, encrypted.");
  } catch (error) {
    return toFormState(error, "setTemporaryPassword");
  }
}

/**
 * Reveal the stored mailbox password.
 *
 * Every reveal is audited with who, when and from where — this is the one
 * operation in the system that hands a credential back to a human (spec §3.7).
 */
export async function revealTemporaryPassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const parsed = employeeIdSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return errorState("That employee could not be found.");

    const { password, setAt } = await employeeService.revealTemporaryPassword(
      session,
      parsed.data.employeeId,
      await clientIp(),
    );

    if (!password) {
      return errorState(
        "No password could be read. Either none is stored, or the encryption key has been rotated since it was saved.",
      );
    }

    return successState("Revealed — this has been recorded in the audit log.", {
      password,
      setAt: setAt ? setAt.toISOString() : "",
    });
  } catch (error) {
    return toFormState(error, "revealTemporaryPassword");
  }
}

export async function clearTemporaryPassword(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const parsed = employeeIdSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) throw new ForbiddenError("That employee could not be found.");

  await employeeService.clearTemporaryPassword(session, parsed.data.employeeId);
  revalidatePath(`/employees/${parsed.data.employeeId}/`);
}
