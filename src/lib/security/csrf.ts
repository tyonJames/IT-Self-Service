import { cookies, headers } from "next/headers";
import { env } from "@/lib/config/env";
import { generateToken, timingSafeEqualString } from "./tokens";
import { SecurityEvent, securityLog } from "@/lib/logging/logger";

/**
 * CSRF protection (spec §6).
 *
 * Defence in depth, three layers:
 *  1. `SameSite=Lax` on the session cookie, so a cross-site POST carries no
 *     session at all.
 *  2. An Origin/Referer check against CSRF_TRUSTED_ORIGINS, mirroring Django's
 *     `CSRF_TRUSTED_ORIGINS`.
 *  3. A double-submit token: a random value in a cookie, echoed in a hidden
 *     form field, compared in constant time.
 *
 * The cookie is seeded by `src/middleware.ts` on GET requests, because Next.js
 * only permits cookie writes from Route Handlers and Server Actions — never
 * during a page render.
 */

export const CSRF_COOKIE = "radx.csrf";
export const CSRF_FIELD = "csrf_token";

export class CsrfError extends Error {
  constructor(message = "CSRF verification failed") {
    super(message);
    this.name = "CsrfError";
  }
}

export function newCsrfToken(): string {
  return generateToken(32);
}

/** The token to embed in a form. Returns "" if middleware has not run yet. */
export async function currentCsrfToken(): Promise<string> {
  return (await cookies()).get(CSRF_COOKIE)?.value ?? "";
}

function trustedOrigins(): string[] {
  const e = env();
  const configured = e.CSRF_TRUSTED_ORIGINS.map((o) => o.replace(/\/+$/, ""));
  const base = e.APP_BASE_URL.replace(/\/+$/, "");
  return configured.length > 0 ? [...new Set([...configured, base])] : [base];
}

/** Is this request's Origin (or Referer) one we accept state changes from? */
export function isTrustedOrigin(h: Headers): boolean {
  const origin = h.get("origin");
  const allowed = trustedOrigins();

  if (origin) {
    return allowed.includes(origin.replace(/\/+$/, ""));
  }

  // Some browsers omit Origin on same-origin form posts; fall back to Referer.
  const referer = h.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      return allowed.includes(`${parsed.protocol}//${parsed.host}`);
    } catch {
      return false;
    }
  }

  // No Origin and no Referer: only tolerated outside production, where a bare
  // curl during development would otherwise be impossible.
  return !env().isProduction;
}

/**
 * Verify a state-changing request. Throws `CsrfError` on failure so callers
 * can surface a friendly message rather than a stack trace.
 */
export async function assertCsrf(formData: FormData | { csrf_token?: string }): Promise<void> {
  const h = await headers();

  if (!isTrustedOrigin(h)) {
    securityLog(SecurityEvent.CSRF_FAILURE, "Rejected request from untrusted origin", "WARNING", {
      origin: h.get("origin") ?? "",
    });
    throw new CsrfError("This request did not come from an allowed origin.");
  }

  const submitted =
    formData instanceof FormData
      ? String(formData.get(CSRF_FIELD) ?? "")
      : String(formData.csrf_token ?? "");

  const expected = (await cookies()).get(CSRF_COOKIE)?.value ?? "";

  if (!submitted || !expected || !timingSafeEqualString(submitted, expected)) {
    securityLog(SecurityEvent.CSRF_FAILURE, "CSRF token missing or mismatched", "WARNING");
    throw new CsrfError("Your session expired or the form was stale. Reload the page and try again.");
  }
}

/** JSON API variant: header-based double submit, for fetch() callers. */
export async function assertCsrfHeader(): Promise<void> {
  const h = await headers();
  if (!isTrustedOrigin(h)) {
    securityLog(SecurityEvent.CSRF_FAILURE, "Rejected API request from untrusted origin", "WARNING");
    throw new CsrfError("This request did not come from an allowed origin.");
  }
  const submitted = h.get("x-csrf-token") ?? "";
  const expected = (await cookies()).get(CSRF_COOKIE)?.value ?? "";
  if (!submitted || !expected || !timingSafeEqualString(submitted, expected)) {
    securityLog(SecurityEvent.CSRF_FAILURE, "CSRF header missing or mismatched", "WARNING");
    throw new CsrfError("Missing or invalid CSRF token.");
  }
}
