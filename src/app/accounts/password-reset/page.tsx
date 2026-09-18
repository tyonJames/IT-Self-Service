import type { Metadata } from "next";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PasswordResetRequestForm } from "@/components/forms/PasswordResetForms";

export const metadata: Metadata = { title: "Reset your password" };
export const dynamic = "force-dynamic";

/** `/accounts/password-reset/` — self-service reset, throttled (spec note 14). */
export default async function PasswordResetPage() {
  const csrfToken = await currentCsrfToken();

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo" aria-hidden="true">
          RX
        </div>
        <h1 className="h5 text-center mb-1">Reset your password</h1>
        <p className="text-center text-secondary small mb-4">
          We will email you a link that works once and expires in an hour.
        </p>

        <PasswordResetRequestForm csrfToken={csrfToken} />
      </div>
    </div>
  );
}
