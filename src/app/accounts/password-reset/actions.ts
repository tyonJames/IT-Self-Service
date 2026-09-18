"use server";

import { z } from "zod";
import { authService } from "@/services/auth.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { clientIp } from "@/lib/security/request";
import { errorState, successState, type FormState } from "@/lib/utils/result";
import { formDataToObject } from "@/lib/validation/common";
import { emailField } from "@/lib/validation/common";
import { logger } from "@/lib/logging/logger";

const requestSchema = z.object({ email: emailField() });

const confirmSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: z.string().min(1, "Enter a new password.").max(256),
    confirmPassword: z.string().min(1, "Confirm your new password.").max(256),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Request a reset link.
 *
 * The response is identical whether or not the address is registered: telling
 * an anonymous visitor which addresses exist turns this form into an account
 * enumeration oracle.
 */
export async function requestPasswordReset(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
  } catch (error) {
    if (error instanceof CsrfError) return errorState(error.message);
    throw error;
  }

  const parsed = requestSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return errorState("Enter the email address on your account.", {
      email: ["Enter a valid email address."],
    });
  }

  const ip = await clientIp();

  try {
    const { throttled } = await authService.requestPasswordReset(parsed.data.email, ip);
    if (throttled) {
      return errorState(
        "Too many reset requests from this network. Wait fifteen minutes, or call IT directly.",
      );
    }
  } catch (error) {
    logger().error({ err: (error as Error).message }, "Password reset request failed");
    // Still report success: a failure here must not reveal anything either.
  }

  return successState(
    "If that address has an account, a reset link is on its way. It expires in an hour — check your junk folder if it does not arrive.",
  );
}

export async function confirmPasswordReset(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
  } catch (error) {
    if (error instanceof CsrfError) return errorState(error.message);
    throw error;
  }

  const parsed = confirmSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return errorState("Please correct the highlighted fields.", fieldErrors);
  }

  const ip = await clientIp();
  const result = await authService.completePasswordReset(
    parsed.data.token,
    parsed.data.password,
    ip,
  );

  if (!result.ok) {
    return errorState(result.errors.join(" "), { password: result.errors });
  }

  return successState(
    "Your password has been changed and you have been signed out everywhere. Sign in with the new one.",
  );
}
