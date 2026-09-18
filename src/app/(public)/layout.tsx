import Link from "next/link";
import { supportContact } from "@/lib/config/support";

/**
 * Public portal shell — no session, no sidebar, no internal navigation.
 * Nothing rendered here reveals anything about the help desk's contents.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const support = supportContact();

  return (
    <div className="public-shell d-flex flex-column min-vh-100">
      <header className="public-header">
        <div className="container d-flex flex-wrap align-items-center justify-content-between gap-2">
          <Link href="/help/" className="d-flex align-items-center gap-2 text-white text-decoration-none">
            <span className="sidebar-brand-mark" aria-hidden="true">
              RX
            </span>
            <span className="fw-semibold">
              Radx IT Help Desk
              <small className="d-block fw-normal opacity-75" style={{ fontSize: "0.75rem" }}>
                Self-service portal
              </small>
            </span>
          </Link>

          <div className="d-flex flex-wrap align-items-center gap-3 small">
            {support.phone && (
              <span>
                <i className="bi bi-telephone me-1" aria-hidden="true" />
                {support.phone}
              </span>
            )}
            {support.email && (
              <a className="text-white text-decoration-none" href={`mailto:${support.email}`}>
                <i className="bi bi-envelope me-1" aria-hidden="true" />
                {support.email}
              </a>
            )}
            <Link className="btn btn-sm btn-light" href="/accounts/login/">
              IT sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="container py-4 flex-grow-1" id="main-content">
        {children}
      </main>

      <footer className="border-top bg-white py-3 mt-4">
        <div className="container d-flex flex-wrap justify-content-between gap-2 small text-secondary">
          <span>Radx Construction — IT Help Desk</span>
          {support.whatsappLink && (
            <a className="text-secondary" href={support.whatsappLink} rel="noopener noreferrer" target="_blank">
              <i className="bi bi-whatsapp me-1" aria-hidden="true" />
              Chat with IT on WhatsApp
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}
