import type { Metadata } from "next";
import Link from "next/link";
import { supportContact } from "@/lib/config/support";

export const metadata: Metadata = {
  title: "Request received",
};

/**
 * `/report/sent/` — confirmation (spec §5.1).
 *
 * Shows only the reference number that was just issued. It deliberately does
 * not look the ticket up: this page has no session, and rendering ticket
 * contents from a URL parameter would let anyone read any ticket by guessing.
 */
export default async function ReportSentPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const params = await searchParams;
  const support = supportContact();

  // Only echo something that actually looks like one of our references.
  const reference = /^RDX-\d{4,}$/.test(params.ref ?? "") ? params.ref : null;

  return (
    <div className="row justify-content-center">
      <div className="col-lg-7">
        <div className="card">
          <div className="card-body text-center p-4">
            <i className="bi bi-check-circle display-5 text-success" aria-hidden="true" />
            <h1 className="h4 mt-3">Thank you — we have your request</h1>

            {reference ? (
              <>
                <p className="text-secondary mb-1">Your reference number is</p>
                <p className="display-6 text-radx fw-semibold mb-3">{reference}</p>
              </>
            ) : (
              <p className="text-secondary">Your request has been logged with the IT team.</p>
            )}

            <p className="text-secondary">
              An IT agent will pick this up and contact you on the email address you gave us. Quote
              your reference number in any follow-up.
            </p>

            <hr />

            <div className="small text-secondary mb-3">
              Urgent? {support.phone && <>Call IT on <strong>{support.phone}</strong>.</>}{" "}
              {support.whatsappLink && (
                <a href={support.whatsappLink} rel="noopener noreferrer" target="_blank">
                  Or message us on WhatsApp.
                </a>
              )}
            </div>

            <div className="d-flex gap-2 justify-content-center">
              <Link className="btn btn-outline-primary" href="/report/">
                Report another problem
              </Link>
              <Link className="btn btn-outline-secondary" href="/help/">
                Back to the portal
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
