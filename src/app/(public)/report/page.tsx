import type { Metadata } from "next";
import Link from "next/link";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PublicTicketForm } from "@/components/tickets/PublicTicketForm";

export const metadata: Metadata = {
  title: "Report an IT problem",
};

export const dynamic = "force-dynamic";

/** `/report/` — public ticket submission (spec §5.1). */
export default async function ReportPage() {
  const [countries, categories, csrfToken] = await Promise.all([
    lookupRepository.countryChoices(),
    lookupRepository.ticketCategoryChoices(),
    currentCsrfToken(),
  ]);

  return (
    <div className="row justify-content-center">
      <div className="col-lg-9 col-xl-8">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="breadcrumb small mb-0">
            <li className="breadcrumb-item">
              <Link href="/help/">Get IT help</Link>
            </li>
            <li className="breadcrumb-item active" aria-current="page">
              Report a problem
            </li>
          </ol>
        </nav>

        <div className="card">
          <div className="card-body p-4">
            <h1 className="h4 mb-1">Report an IT problem</h1>
            <p className="text-secondary">
              Fill this in and IT will pick it up. You will get a reference number as soon as you
              submit.
            </p>

            <PublicTicketForm countries={countries} categories={categories} csrfToken={csrfToken} />
          </div>
        </div>
      </div>
    </div>
  );
}
