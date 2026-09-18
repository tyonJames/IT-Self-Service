import type { Metadata } from "next";
import Link from "next/link";
import { supportContact } from "@/lib/config/support";
import { env } from "@/lib/config/env";

export const metadata: Metadata = { title: "Sign-in help" };

/** `/accounts/help/` — public help for someone locked out (spec §4). */
export default function AccountsHelpPage() {
  const support = supportContact();
  const lockoutMinutes = Math.round(env().LOGIN_LOCKOUT_SECONDS / 60);
  const maxAttempts = env().LOGIN_MAX_ATTEMPTS;

  return (
    <div className="login-shell">
      <div className="login-card" style={{ maxWidth: 520 }}>
        <div className="login-logo" aria-hidden="true">
          RX
        </div>
        <h1 className="h5 text-center mb-4">Trouble signing in?</h1>

        <dl className="small">
          <dt>I have forgotten my password</dt>
          <dd className="text-secondary">
            Use <Link href="/accounts/password-reset/">the reset link</Link>. It arrives at your work
            email address and works once.
          </dd>

          <dt>It says my account is locked</dt>
          <dd className="text-secondary">
            After {maxAttempts} failed attempts an account locks for {lockoutMinutes} minutes. Wait
            it out, or reset your password — a successful reset clears the lock.
          </dd>

          <dt>I do not have an account</dt>
          <dd className="text-secondary">
            Only IT staff have accounts here. Everyone else uses the{" "}
            <Link href="/help/">self-service portal</Link> — no sign-in needed to report a problem or
            request equipment.
          </dd>

          <dt>Someone asked me for my password</dt>
          <dd className="text-secondary">
            IT will never ask for it — not by phone, email or WhatsApp. If someone does, report it
            {support.email ? (
              <>
                {" "}
                to <a href={`mailto:${support.email}`}>{support.email}</a>
              </>
            ) : (
              " to IT"
            )}
            .
          </dd>
        </dl>

        <hr />

        <div className="small text-secondary text-center">
          {support.phone && (
            <div>
              <i className="bi bi-telephone me-1" aria-hidden="true" />
              {support.phone}
            </div>
          )}
          {support.whatsappLink && (
            <div>
              <a href={support.whatsappLink} rel="noopener noreferrer" target="_blank">
                <i className="bi bi-whatsapp me-1" aria-hidden="true" />
                Message IT on WhatsApp
              </a>
            </div>
          )}
        </div>

        <div className="d-grid mt-3">
          <Link className="btn btn-outline-secondary btn-sm" href="/accounts/login/">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
