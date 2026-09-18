"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authService } from "@/services/auth.service";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { clientIp } from "@/lib/security/request";
import { errorState, type FormState } from "@/lib/utils/result";
import { formDataToObject } from "@/lib/validation/common";
import { logger } from "@/lib/logging/logger";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email address or username.").max(254),
  password: z.string().min(1, "Enter your password.").max(256),
  next: z.string().optional(),
});

/** Only same-site, absolute-path redirects — never an attacker-supplied URL. */
function safeNext(next: string | undefined): string {
  if (!next) return "/tickets/reports/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/tickets/reports/";
  if (next.startsWith("/accounts/login")) return "/tickets/reports/";
  return next;
}

export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
  } catch (error) {
    if (error instanceof CsrfError) return errorState(error.message);
    throw error;
  }

  const parsed = loginSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return errorState("Enter your email address and password.");
  }

  const ip = await clientIp();

  let outcome;
  try {
    outcome = await authService.login(parsed.data.identifier, parsed.data.password, ip);
  } catch (error) {
    logger().error({ err: (error as Error).message }, "Sign-in failed unexpectedly");
    return errorState("We could not sign you in just now. Please try again in a moment.");
  }

  if (!outcome.ok) {
    return errorState(outcome.message);
  }

  redirect(safeNext(parsed.data.next));
}
