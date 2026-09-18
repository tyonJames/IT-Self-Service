import type { Metadata } from "next";
import Link from "next/link";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PublicEquipmentForm } from "@/components/equipment/PublicEquipmentForm";

export const metadata: Metadata = {
  title: "Request equipment",
};

export const dynamic = "force-dynamic";

/** `/request-equipment/` — public equipment request (spec §5.2). */
export default async function RequestEquipmentPage() {
  const [countries, itemTypes, csrfToken] = await Promise.all([
    lookupRepository.countryChoices(),
    lookupRepository.listEquipmentItemTypes({ activeOnly: true }),
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
              Request equipment
            </li>
          </ol>
        </nav>

        <div className="card">
          <div className="card-body p-4">
            <h1 className="h4 mb-1">Request equipment</h1>
            <p className="text-secondary">
              Tell us what you need and why. IT will review the request and email you the outcome.
            </p>

            <PublicEquipmentForm
              countries={countries}
              itemTypes={itemTypes.map((t) => ({ slug: t.slug, name: t.name }))}
              csrfToken={csrfToken}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
