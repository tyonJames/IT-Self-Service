import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PageHeader } from "@/components/ui";
import { CsvImportForm } from "@/components/forms/CsvImportForm";

export const metadata: Metadata = { title: "Import employees" };
export const dynamic = "force-dynamic";

const COLUMNS = [
  { name: "full_name", required: true, note: "First name and surname" },
  { name: "email", required: true, note: "Must be unique — this is what matches tickets and requests to a person" },
  { name: "phone", required: false, note: "" },
  { name: "department", required: false, note: "" },
  { name: "job_title", required: false, note: "" },
  { name: "site", required: false, note: "Country code: ZW, MZ, GR, NA. ZA is accepted and stored as GR" },
  { name: "employee_number", required: false, note: "Must be unique if given; blanks are stored as NULL" },
  { name: "staff_group", required: false, note: "staff, management or consultant. Defaults to staff" },
  { name: "alt_email", required: false, note: "Other address this person uses" },
  { name: "is_active", required: false, note: "true/false, yes/no, 1/0. Defaults to true" },
  { name: "notes", required: false, note: "" },
];

const SAMPLE = `full_name,email,department,job_title,site,staff_group,phone
Tendai Moyo,t.moyo@radxconstruction.com,Finance,Accountant,ZW,staff,+263 77 000 0000
Ana Sitoe,a.sitoe@radxconstruction.com,Operations,Site Supervisor,MZ,management,
Pieter van Wyk,p.vanwyk@radxconstruction.com,Plant,Plant Manager,GR,management,`;

/** `/employees/import/` — CSV import (spec §5.19). */
export default async function EmployeeImportPage() {
  await requireAgent("/employees/import/");
  const csrfToken = await currentCsrfToken();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/employees/">Employees</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Import
          </li>
        </ol>
      </nav>

      <PageHeader
        title="Import employees from CSV"
        icon="bi-upload"
        subtitle="Bulk-create or update people. Rehearse first — the whole file is validated before anything is saved."
      />

      <CsvImportForm kind="employees" csrfToken={csrfToken} columns={COLUMNS} sample={SAMPLE} />
    </>
  );
}
