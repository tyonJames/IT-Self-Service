import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/session";
import { currentCsrfToken } from "@/lib/security/csrf";
import { supportContact } from "@/lib/config/support";
import { LoginForm } from "@/components/forms/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export const dynamic = "force-dynamic";

/** `/accounts/login/` — branded green gradient login (spec §1). */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/tickets/reports/");

  const [params, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  const support = supportContact();

  const next = params.next && params.next.startsWith("/") && !params.next.startsWith("//")
    ? params.next
    : "/tickets/reports/";

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo" aria-hidden="true">
          RX
        </div>
        <h1 className="h5 text-center mb-1">Radx IT Help Desk</h1>
        <p className="text-center text-secondary small mb-4">Sign in to manage tickets and assets</p>

        <LoginForm csrfToken={csrfToken} next={next} />

        <div className="d-flex justify-content-between mt-3 small">
          <Link href="/accounts/password-reset/">Forgot your password?</Link>
          <Link href="/accounts/help/">Need help?</Link>
        </div>

        <hr className="my-4" />

        <p className="small text-secondary text-center mb-2">
          Not IT staff? You do not need an account.
        </p>
        <div className="d-grid">
          <Link className="btn btn-outline-primary btn-sm" href="/help/">
            <i className="bi bi-life-preserver me-1" aria-hidden="true" />
            Report a problem or request equipment
          </Link>
        </div>

        {(support.phone || support.email) && (
          <p className="small text-secondary text-center mt-3 mb-0">
            {support.phone && <>IT: {support.phone}</>}
            {support.phone && support.email && " · "}
            {support.email && <a href={`mailto:${support.email}`}>{support.email}</a>}
          </p>
        )}
      </div>
    </div>
  );
}
