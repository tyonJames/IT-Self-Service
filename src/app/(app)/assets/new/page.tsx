import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { lookupRepository } from "@/repositories/lookup.repository";
import { prisma } from "@/lib/db/prisma";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PageHeader } from "@/components/ui";
import { AssetForm, type AssetFormValues } from "@/components/assets/AssetForm";

export const metadata: Metadata = { title: "Add an asset" };
export const dynamic = "force-dynamic";

const EMPTY: AssetFormValues = {
  assetTag: "",
  category: "laptop",
  brand: "",
  model: "",
  serialNumber: "",
  status: "active",
  assignedEmployeeId: "",
  assignedSiteId: "",
  department: "",
  site: "ZW",
  location: "",
  macAddress: "",
  osVersion: "",
  officeVersion: "",
  laptopOrDesktop: "",
  imei1: "",
  imei2: "",
  cellNumber: "",
  package: "",
  printerType: "",
  tonerType: "",
  ipAddress: "",
  areaCode: "",
  acquisitionDate: "",
  notes: "",
};

/** `/assets/new/` */
export default async function NewAssetPage() {
  await requireAgent("/assets/new/");

  const [countries, sites, employees, csrfToken] = await Promise.all([
    lookupRepository.countryChoices(),
    lookupRepository.listSites({ activeOnly: true }),
    prisma.employee.findMany({
      where: { isDeleted: false, isActive: true },
      select: { id: true, fullName: true, department: true, site: true },
      orderBy: { fullName: "asc" },
    }),
    currentCsrfToken(),
  ]);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/assets/">Assets</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Add an asset
          </li>
        </ol>
      </nav>

      <PageHeader title="Add an asset" icon="bi-plus-square" subtitle="Register a new device" />

      <AssetForm
        mode="create"
        values={EMPTY}
        countries={countries}
        employees={employees.map((e) => ({
          id: e.id,
          label: e.department ? `${e.fullName} — ${e.department}` : e.fullName,
        }))}
        sites={sites.map((s) => ({
          id: s.id,
          label: s.code ? `${s.name} (${s.code})` : s.name,
          country: s.siteCountry,
        }))}
        csrfToken={csrfToken}
      />
    </>
  );
}
