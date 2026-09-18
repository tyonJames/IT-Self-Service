import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/permissions";
import { assetRepository } from "@/repositories/asset.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { prisma } from "@/lib/db/prisma";
import { currentCsrfToken } from "@/lib/security/csrf";
import { PageHeader } from "@/components/ui";
import { AssetForm, type AssetFormValues } from "@/components/assets/AssetForm";

export const metadata: Metadata = { title: "Edit asset" };
export const dynamic = "force-dynamic";

/** `/assets/{id}/edit/` */
export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAgent();

  const { id } = await params;
  const assetId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(assetId) || assetId <= 0) notFound();

  const asset = await assetRepository.findById(assetId);
  if (!asset) notFound();

  const [countries, sites, employees, csrfToken] = await Promise.all([
    lookupRepository.countryChoices(),
    lookupRepository.listSites({ activeOnly: true }),
    prisma.employee.findMany({
      where: { isDeleted: false, isActive: true },
      select: { id: true, fullName: true, department: true },
      orderBy: { fullName: "asc" },
    }),
    currentCsrfToken(),
  ]);

  const values: AssetFormValues = {
    id: asset.id,
    assetTag: asset.assetTag ?? "",
    category: asset.category,
    brand: asset.brand,
    model: asset.model,
    serialNumber: asset.serialNumber,
    status: asset.status,
    assignedEmployeeId: asset.assignedEmployeeId ? String(asset.assignedEmployeeId) : "",
    assignedSiteId: asset.assignedSiteId ? String(asset.assignedSiteId) : "",
    department: asset.department,
    site: asset.site,
    location: asset.location,
    macAddress: asset.macAddress,
    osVersion: asset.osVersion,
    officeVersion: asset.officeVersion,
    laptopOrDesktop: asset.laptopOrDesktop,
    imei1: asset.imei1,
    imei2: asset.imei2,
    cellNumber: asset.cellNumber,
    package: asset.package,
    printerType: asset.printerType,
    tonerType: asset.tonerType,
    ipAddress: asset.ipAddress,
    areaCode: asset.areaCode,
    acquisitionDate: asset.acquisitionDate
      ? asset.acquisitionDate.toISOString().slice(0, 10)
      : "",
    notes: asset.notes,
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/assets/">Assets</Link>
          </li>
          <li className="breadcrumb-item">
            <Link href={`/assets/${asset.id}/`}>{asset.assetTag ?? `#${asset.id}`}</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Edit
          </li>
        </ol>
      </nav>

      <PageHeader
        title={`Edit ${asset.assetTag ?? `asset #${asset.id}`}`}
        icon="bi-pencil-square"
      />

      <AssetForm
        mode="edit"
        values={values}
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
