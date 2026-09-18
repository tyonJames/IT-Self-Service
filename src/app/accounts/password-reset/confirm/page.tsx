import type { Metadata } from "next";
import Link from "next/link";
import { currentCsrfToken } from "@/lib/security/csrf";
import { authService } from "@/services/auth.service";
import { env } from "@/lib/config/env";
import { PasswordResetConfirmForm } from "@/components/forms/PasswordResetForms";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

/** `/accounts/password-reset/confirm/?token=…` */
export default async function PasswordResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [params, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  const token = params.token ?? "";
  const valid = token ? await authService.validateResetToken(token) : null;

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo" aria-hidden="true">
          RX
        </div>

        {valid ? (
          <>
            <h1 className="h5 text-center mb-1">Choose a new password</h1>
            <p className="text-center text-secondary small mb-4">
              Setting a new password signs you out on every device.
            </p>
            <PasswordResetConfirmForm
              csrfToken={csrfToken}
              token={token}
              minLength={env().PASSWORD_MIN_LENGTH}
            />
          </>
        ) : (
          <>
            <h1 className="h5 text-center mb-2">That link no longer works</h1>
            <p className="text-center text-secondary small mb-4">
              Reset links expire after an hour and can only be used once. Request a fresh one.
            </p>
            <div className="d-grid gap-2">
              <Link className="btn btn-primary" href="/accounts/password-reset/">
                Request a new link
              </Link>
              <Link className="btn btn-outline-secondary" href="/accounts/login/">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
