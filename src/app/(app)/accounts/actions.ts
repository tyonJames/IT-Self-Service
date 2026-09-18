"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { userService, UserValidationError } from "@/services/user.service";
import { authService } from "@/services/auth.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { requireAdmin, requireAuthenticatedUser, ForbiddenError } from "@/lib/permissions";
import { clientIp } from "@/lib/security/request";
import {
  countryField,
  emailField,
  formDataToObject,
  optionalText,
  requiredText,
} from "@/lib/validation/common";
import { errorState, successState, zodErrorState, type FormState } from "@/lib/utils/result";
import { logger } from "@/lib/logging/logger";

/** Account management actions (spec §4, §5). */

function toFormState(error: unknown, context: string): FormState {
  if (error instanceof CsrfError) return errorState(error.message);
  if (error instanceof ForbiddenError) return errorState(error.message);
  if (error instanceof UserValidationError) {
    return errorState(error.message, error.field ? { [error.field]: [error.message] } : undefined);
  }
  if (typeof error === "object" && error !== null && "digest" in error) throw error;

  logger().error({ context, err: (error as Error).message }, "Account action failed");
  return errorState("Something went wrong. The problem has been logged — please try again.");
}

const createUserSchema = z.object({
  username: requiredText("Username", 60).pipe(
    z
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes and underscores only.")
      .transform((v) => v.toLowerCase()),
  ),
  email: emailField(),
  firstName: optionalText(80),
  lastName: optionalText(80),
  password: z.string().min(1, "Enter a password.").max(256),
  role: z.enum(["staff", "agent", "admin"]).catch("staff"),
  site: countryField(),
  department: optionalText(120),
  phone: optionalText(40),
});

/** Only an admin creates accounts — there is no public registration (spec note 10). */
export async function createUser(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAdmin();

    const parsed = createUserSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await userService.create(session, {
      ...parsed.data,
      role: parsed.data.role as Role,
    });

    revalidatePath("/accounts/users/");
    return successState(`Account created for ${parsed.data.username}.`);
  } catch (error) {
    return toFormState(error, "createUser");
  }
}

const roleSchema = z.object({
  userId: z.coerce.number().int().positive(),
  role: z.enum(["staff", "agent", "admin"]),
});

export async function changeUserRole(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAdmin();

    const parsed = roleSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await userService.changeRole(session, parsed.data.userId, parsed.data.role as Role);

    revalidatePath("/accounts/users/");
    return successState("Role changed. That user has been signed out so it takes effect at once.");
  } catch (error) {
    return toFormState(error, "changeUserRole");
  }
}

export async function toggleUserActive(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAdmin();

  const userId = Number.parseInt(String(formData.get("userId") ?? ""), 10);
  const makeActive = String(formData.get("isActive") ?? "") === "1";
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ForbiddenError("That account could not be found.");
  }

  await userService.setActive(session, userId, makeActive);
  revalidatePath("/accounts/users/");
}

const profileSchema = z.object({
  firstName: optionalText(80),
  lastName: optionalText(80),
  department: optionalText(120),
  phone: optionalText(40),
  site: countryField(),
});

export async function updateOwnProfile(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAuthenticatedUser();

    const parsed = profileSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    // Note there is no `role` field here, by design: a user editing their own
    // profile must not be able to submit one (mass-assignment defence).
    await userService.updateOwnProfile(session, parsed.data);

    revalidatePath("/accounts/profile/");
    return successState("Profile updated.");
  } catch (error) {
    return toFormState(error, "updateOwnProfile");
  }
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(256),
    newPassword: z.string().min(1, "Enter a new password.").max(256),
    confirmPassword: z.string().min(1, "Confirm the new password.").max(256),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

export async function changeOwnPassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAuthenticatedUser();

    const parsed = changePasswordSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const result = await authService.changeOwnPassword(
      session.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      await clientIp(),
    );

    if (!result.ok) {
      return errorState(result.errors.join(" "), { newPassword: result.errors });
    }

    return successState("Password changed.");
  } catch (error) {
    return toFormState(error, "changeOwnPassword");
  }
}
