import type { Metadata } from "next";
import { requireAgent } from "@/lib/permissions";
import { lookupRepository } from "@/repositories/lookup.repository";
import { prisma } from "@/lib/db/prisma";
import { currentCsrfToken } from "@/lib/security/csrf";
import { countryColour } from "@/lib/config/countries";
import { Alert, PageHeader } from "@/components/ui";
import { LookupManager, type LookupRow } from "@/components/manage/LookupManager";
import { deleteCountry, saveCountry } from "../actions";

export const metadata: Metadata = { title: "Countries" };
export const dynamic = "force-dynamic";

/** `/manage/countries/` (spec §5.14). */
export default async function ManageCountriesPage() {
  await requireAgent("/manage/countries/");

  const [countries, assetCounts, employeeCounts, csrfToken] = await Promise.all([
    lookupRepository.listCountries({}),
    prisma.asset.groupBy({ by: ["site"], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.employee.groupBy({ by: ["site"], where: { isDeleted: false }, _count: { _all: true } }),
    currentCsrfToken(),
  ]);

  const assets = new Map(assetCounts.map((a) => [a.site, a._count._all]));
  const employees = new Map(employeeCounts.map((e) => [e.site, e._count._all]));

  const rows: LookupRow[] = countries.map((country) => {
    const used = (assets.get(country.code) ?? 0) + (employees.get(country.code) ?? 0);
    return {
      id: country.id,
      isActive: country.isActive,
      cells: [
        country.name,
        country.code,
        assets.get(country.code) ?? 0,
        employees.get(country.code) ?? 0,
        country.isActive ? "Active" : "Inactive",
      ],
      values: { name: country.name, code: country.code, sortOrder: String(country.sortOrder) },
      deleteBlockedReason: used > 0 ? `${used} record(s) reference this country` : undefined,
    };
  });

  return (
    <>
      <PageHeader
        title="Countries"
        icon="bi-globe-europe-africa"
        subtitle="The operating countries, and the accent colour each one gets across the app"
      />

      <Alert variant="info" title="South Africa uses the code GR">
        Radx uses <code>GR</code> (the Griffin entity) rather than the ISO <code>ZA</code>. Anything
        arriving as <code>ZA</code> is normalised to <code>GR</code> before it is stored, so each
        country has exactly one code and one colour.
      </Alert>

      <div className="d-flex flex-wrap gap-3 mb-3">
        {countries.map((country) => (
          <span key={country.id} className="d-inline-flex align-items-center gap-2 small">
            <span
              className="d-inline-block rounded"
              style={{ width: 16, height: 16, background: countryColour(country.code) }}
              aria-hidden="true"
            />
            {country.name} — <code>{countryColour(country.code)}</code>
          </span>
        ))}
      </div>

      <LookupManager
        title="All countries"
        columns={["Name", "Code", "Assets", "Employees", "Status"]}
        rows={rows}
        addLabel="Add a country"
        fields={[
          { name: "name", label: "Country name", type: "text", required: true, maxLength: 120 },
          {
            name: "code",
            label: "Code",
            type: "text",
            required: true,
            createOnly: true,
            maxLength: 10,
            colClass: "col-6",
            hint: "2–5 letters. Stored on every asset, employee and ticket — cannot be changed later.",
          },
          { name: "sortOrder", label: "Sort order", type: "number", colClass: "col-6" },
        ]}
        saveAction={saveCountry}
        deleteAction={deleteCountry}
        csrfToken={csrfToken}
      />
    </>
  );
}
