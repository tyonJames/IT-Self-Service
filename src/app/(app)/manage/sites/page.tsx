import type { Metadata } from "next";
import { requireAgent } from "@/lib/permissions";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { countryName, COUNTRY_CODES } from "@/lib/config/countries";
import { PageHeader } from "@/components/ui";
import { LookupManager, type LookupRow } from "@/components/manage/LookupManager";
import { deleteSite, saveSite } from "../actions";

export const metadata: Metadata = { title: "Sites" };
export const dynamic = "force-dynamic";

/** `/manage/sites/` (spec §5.14). */
export default async function ManageSitesPage() {
  await requireAgent("/manage/sites/");

  const [sites, assetCounts, csrfToken] = await Promise.all([
    lookupRepository.listSites({}),
    lookupRepository.siteAssetCounts(),
    currentCsrfToken(),
  ]);

  const rows: LookupRow[] = sites.map((site) => {
    const assets = assetCounts.get(site.id) ?? 0;
    return {
      id: site.id,
      isActive: site.isActive,
      cells: [
        site.name,
        site.code || "—",
        countryName(site.siteCountry),
        assets,
        site.isActive ? "Active" : "Inactive",
      ],
      values: {
        name: site.name,
        code: site.code,
        siteCountry: site.siteCountry,
        address: site.address,
        notes: site.notes,
      },
      deleteBlockedReason: assets > 0 ? `${assets} asset(s) are assigned here` : undefined,
    };
  });

  return (
    <>
      <PageHeader
        title="Sites"
        icon="bi-geo-alt"
        subtitle="Offices and sites. These feed the cascading Country → Site dropdown on the public forms."
      />

      <LookupManager
        title="All sites"
        columns={["Name", "Code", "Country", "Assets", "Status"]}
        rows={rows}
        addLabel="Add a site"
        emptyHint="No sites yet. Add one so the public forms can offer it."
        fields={[
          { name: "name", label: "Site name", type: "text", required: true, maxLength: 150 },
          { name: "code", label: "Short code", type: "text", maxLength: 30, colClass: "col-6", hint: "e.g. HRE-HO" },
          {
            name: "siteCountry",
            label: "Country",
            type: "select",
            required: true,
            colClass: "col-6",
            options: COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })),
          },
          { name: "address", label: "Address", type: "text", maxLength: 250 },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 1000 },
        ]}
        saveAction={saveSite}
        deleteAction={deleteSite}
        csrfToken={csrfToken}
      />
    </>
  );
}
