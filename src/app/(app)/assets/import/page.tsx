import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PageHeader } from "@/components/ui";
import { CsvImportForm } from "@/components/forms/CsvImportForm";

export const metadata: Metadata = { title: "Import assets" };
export const dynamic = "force-dynamic";

const COLUMNS = [
  { name: "category", required: true, note: "laptop, desktop, phone, printer, monitor, clocking, starlink, other" },
  { name: "asset_tag", required: false, note: "Leave blank for untagged devices — blanks are stored as NULL, so many are allowed" },
  { name: "brand", required: false, note: "Make" },
  { name: "model", required: false, note: "" },
  { name: "serial_number", required: false, note: "Used to match the device when the tracking agent enrols" },
  { name: "status", required: false, note: "active, faulty, repair, retired, spare, return_pending, stolen. Defaults to active" },
  { name: "site", required: false, note: "Country code: ZW, MZ, GR, NA. ZA is accepted and stored as GR" },
  { name: "location", required: false, note: "The physical site name" },
  { name: "department", required: false, note: "" },
  { name: "assigned_to_email", required: false, note: "Assigns to that employee. Takes precedence over assigned_site" },
  { name: "assigned_site", required: false, note: "Assigns to that site by name. Ignored if assigned_to_email is set" },
  { name: "mac_address", required: false, note: "Any separator style; stored as AA:BB:CC:DD:EE:FF" },
  { name: "os_version", required: false, note: "Laptops and desktops" },
  { name: "office_version", required: false, note: "Laptops and desktops" },
  { name: "imei_1 / imei_2 / cell_number / package", required: false, note: "Phones" },
  { name: "printer_type / toner_type", required: false, note: "Printers" },
  { name: "ip_address / area_code", required: false, note: "Clocking devices" },
  { name: "notes", required: false, note: "" },
];

const SAMPLE = `asset_tag,category,brand,model,serial_number,status,site,location,assigned_to_email
RDX-ZL014,laptop,Dell,Latitude 5420,7XQ4RN3,active,ZW,Harare Head Office,t.james@radxconstruction.com
RDX-ZP002,printer,HP,LaserJet M404,VNB3K10921,active,ZW,Harare Head Office,
,monitor,Dell,P2422H,CN0J1M2K,spare,MZ,Maputo Office,`;

/** `/assets/import/` — CSV import (spec §5.19). */
export default async function AssetImportPage() {
  await requireAgent("/assets/import/");
  const csrfToken = await currentCsrfToken();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/assets/">Assets</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Import
          </li>
        </ol>
      </nav>

      <PageHeader
        title="Import assets from CSV"
        icon="bi-upload"
        subtitle="Bulk-create or update devices. Rehearse first — the whole file is validated before anything is saved."
      />

      <CsvImportForm kind="assets" csrfToken={csrfToken} columns={COLUMNS} sample={SAMPLE} />
    </>
  );
}
