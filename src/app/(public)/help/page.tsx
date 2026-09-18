import type { Metadata } from "next";
import Link from "next/link";
import { supportContact } from "@/lib/config/support";

export const metadata: Metadata = {
  title: "Get IT help",
  description: "Report an IT problem or request equipment from the Radx IT team.",
};

/**
 * `/help/` — the self-service landing page (spec §4).
 * Two doors: report a problem, or ask for equipment.
 */
export default function HelpPage() {
  const support = supportContact();

  return (
    <>
      <div className="text-center mb-4">
        <h1 className="h3">How can IT help?</h1>
        <p className="text-secondary mb-0">
          No sign-in needed. Pick the option that matches what you need and we will get back to you.
        </p>
      </div>

      <div className="row g-3 justify-content-center">
        <div className="col-md-6 col-lg-5">
          <Link href="/report/" className="help-tile">
            <i className="bi bi-tools help-tile-icon" aria-hidden="true" />
            <h2 className="h5 mt-3 mb-2">Report an IT problem</h2>
            <p className="text-secondary mb-3 small">
              Something broken or not working — a laptop, printer, the network, email, access to a
              system. You will get a reference number straight away.
            </p>
            <span className="btn btn-primary btn-sm">
              Report a problem
              <i className="bi bi-arrow-right ms-1" aria-hidden="true" />
            </span>
          </Link>
        </div>

        <div className="col-md-6 col-lg-5">
          <Link href="/request-equipment/" className="help-tile">
            <i className="bi bi-box-seam help-tile-icon" aria-hidden="true" />
            <h2 className="h5 mt-3 mb-2">Request equipment</h2>
            <p className="text-secondary mb-3 small">
              Ask for a laptop, monitor, printer, charger, bag or anything else you need for your
              work. IT will review the request and let you know.
            </p>
            <span className="btn btn-primary btn-sm">
              Request equipment
              <i className="bi bi-arrow-right ms-1" aria-hidden="true" />
            </span>
          </Link>
        </div>
      </div>

      <div className="row justify-content-center mt-4">
        <div className="col-lg-10">
          <div className="card">
            <div className="card-body">
              <h2 className="h6 mb-3">
                <i className="bi bi-lightning-charge text-radx me-2" aria-hidden="true" />
                Need it sorted right now?
              </h2>
              <div className="row g-3 small">
                {support.phone && (
                  <div className="col-sm-4">
                    <div className="text-secondary">Call IT</div>
                    <a className="fw-medium text-decoration-none" href={`tel:${support.phone.replace(/\s/g, "")}`}>
                      {support.phone}
                    </a>
                  </div>
                )}
                {support.whatsappLink && (
                  <div className="col-sm-4">
                    <div className="text-secondary">WhatsApp</div>
                    <a
                      className="fw-medium text-decoration-none"
                      href={support.whatsappLink}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Message the IT team
                    </a>
                  </div>
                )}
                {support.email && (
                  <div className="col-sm-4">
                    <div className="text-secondary">Email</div>
                    <a className="fw-medium text-decoration-none" href={`mailto:${support.email}`}>
                      {support.email}
                    </a>
                  </div>
                )}
              </div>
              <hr />
              <p className="small text-secondary mb-0">
                IT will never ask you for your password — not by phone, not by email, not on WhatsApp.
                If someone does, report it.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
