import { CSRF_FIELD, currentCsrfToken } from "@/lib/security/csrf";

/**
 * Hidden double-submit CSRF field.
 *
 * The token is seeded into an httpOnly cookie by `src/middleware.ts` and read
 * back here at render time; `assertCsrf()` compares the two on submit. Every
 * form that mutates state includes this.
 */
export async function CsrfField() {
  const token = await currentCsrfToken();
  return <input type="hidden" name={CSRF_FIELD} value={token} />;
}
