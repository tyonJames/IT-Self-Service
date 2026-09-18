import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { employeeRepository } from "@/repositories/employee.repository";
import { assetRepository } from "@/repositories/asset.repository";
import { prisma } from "@/lib/db/prisma";
import { tagMismatch, expectedTagPrefix } from "@/lib/domain/asset-tag";
import { countryColour, countryName, COUNTRY_CODES } from "@/lib/config/countries";
import { ASSET_CATEGORY_LABELS } from "@/lib/domain/assets";
import { EmptyState, PageHeader, StatTile } from "@/components/ui";

export const metadata: Metadata = { title: "Data health" };
export const dynamic = "force-dynamic";

/**
 * `/employees/health/` — the reconciliation view (spec §5.11).
 *
 * Four questions IT actually needs answered: who has no kit, what kit has no
 * owner, who looks like a duplicate, and which stickers disagree with the
 * record. Each is a link into the place where it can be fixed.
 */
export default async function DataHealthPage() {
  await requireAgent("/employees/health/");

  const [withoutAssets, duplicates, tagRows, unassignedAssets, totals] = await Promise.all([
    employeeRepository.withoutAssets(),
    employeeRepository.duplicateCandidates(),
    assetRepository.tagAuditRows(),
    assetRepository.list(
      { unassignedOnly: true, inServiceOnly: true },
      { page: 1, pageSize: 100, skip: 0, take: 100 },
    ),
    Promise.all([
      prisma.employee.count({ where: { isDeleted: false, isActive: true } }),
      prisma.asset.count({ where: { isDeleted: false, status: { notIn: ["retired", "stolen"] } } }),
      prisma.asset.count({ where: { isDeleted: false, assetTag: null } }),
    ]),
  ]);

  const [activeEmployees, assetsInService, untagged] = totals;

  const mismatches = tagRows
    .map((row) => ({ row, message: tagMismatch(row) }))
    .filter((m): m is { row: (typeof tagRows)[number]; message: string } => m.message !== null);

  // Heatmap: how each country is doing on the two things that matter.
  const heat = await Promise.all(
    COUNTRY_CODES.map(async (code) => {
      const [employees, assets, unassigned, noDevice] = await Promise.all([
        prisma.employee.count({ where: { isDeleted: false, isActive: true, site: code } }),
        prisma.asset.count({
          where: { isDeleted: false, site: code, status: { notIn: ["retired", "stolen"] } },
        }),
        prisma.asset.count({
          where: {
            isDeleted: false,
            site: code,
            assignedEmployeeId: null,
            assignedSiteId: null,
            status: { notIn: ["retired", "stolen"] },
          },
        }),
        prisma.employee.count({
          where: { isDeleted: false, isActive: true, site: code, assets: { none: { isDeleted: false } } },
        }),
      ]);
      return { code, employees, assets, unassigned, noDevice };
    }),
  );

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/employees/">Employees</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Data health
          </li>
        </ol>
      </nav>

      <PageHeader
        title="Data health"
        icon="bi-heart-pulse"
        subtitle="Where the register and reality have drifted apart"
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3">
          <StatTile label="Active employees" value={activeEmployees} icon="bi-people" variant="dark" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile label="Devices in service" value={assetsInService} icon="bi-hdd-stack" variant="dark" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="Unassigned devices"
            value={unassignedAssets.total}
            icon="bi-question-circle"
            variant={unassignedAssets.total > 0 ? "warning" : "success"}
            hint="In service but nobody's name on them"
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="Tag mismatches"
            value={mismatches.length}
            icon="bi-upc-scan"
            variant={mismatches.length > 0 ? "danger" : "success"}
            hint={`${untagged} device(s) have no tag at all`}
          />
        </div>
      </div>

      {/* Heatmap grid (spec §5.11) */}
      <div className="card mb-3">
        <div className="card-header">By country</div>
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <caption className="visually-hidden">Data health by country</caption>
            <thead className="table-light">
              <tr>
                <th scope="col">Country</th>
                <th scope="col" className="text-end">
                  Active employees
                </th>
                <th scope="col" className="text-end">
                  Devices in service
                </th>
                <th scope="col" className="text-end">
                  Devices per person
                </th>
                <th scope="col" className="text-end">
                  Unassigned devices
                </th>
                <th scope="col" className="text-end">
                  People with no device
                </th>
              </tr>
            </thead>
            <tbody>
              {heat.map((row) => {
                const ratio = row.employees > 0 ? row.assets / row.employees : 0;
                return (
                  <tr key={row.code}>
                    <th scope="row" className="fw-normal">
                      <span
                        className="country-accent ps-2 d-inline-block"
                        style={{ ["--country-accent" as string]: countryColour(row.code) }}
                      >
                        {countryName(row.code)}
                      </span>
                    </th>
                    <td className="text-end">{row.employees}</td>
                    <td className="text-end">{row.assets}</td>
                    <td className="text-end">
                      <span
                        className={`badge bg-${ratio >= 0.9 ? "success" : ratio >= 0.5 ? "warning" : "danger"}`}
                        title="Devices in service divided by active employees"
                      >
                        {ratio.toFixed(2)}
                      </span>
                    </td>
                    <td className="text-end">
                      {row.unassigned > 0 ? (
                        <Link href={`/assets/?country=${row.code}&unassigned=1`} className="text-warning">
                          {row.unassigned}
                        </Link>
                      ) : (
                        <span className="text-secondary">0</span>
                      )}
                    </td>
                    <td className="text-end">
                      {row.noDevice > 0 ? (
                        <span className="text-warning">{row.noDevice}</span>
                      ) : (
                        <span className="text-secondary">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">
              Employees with no device ({withoutAssets.length})
            </div>
            <div className="card-body p-0">
              {withoutAssets.length === 0 ? (
                <EmptyState icon="bi-check-circle" title="Everyone active has at least one device" />
              ) : (
                <div className="table-responsive" style={{ maxHeight: 340 }}>
                  <table className="table table-sm mb-0">
                    <caption className="visually-hidden">Active employees with no device assigned</caption>
                    <thead className="table-light table-sticky">
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Department</th>
                        <th scope="col">Country</th>
                      </tr>
                    </thead>
                    <tbody>
                      {withoutAssets.map((employee) => (
                        <tr key={employee.id}>
                          <th scope="row" className="fw-normal">
                            <Link href={`/employees/${employee.id}/`}>{employee.fullName}</Link>
                          </th>
                          <td className="small">{employee.department || "—"}</td>
                          <td className="small">{countryName(employee.site)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">
              Devices with no owner ({unassignedAssets.total})
            </div>
            <div className="card-body p-0">
              {unassignedAssets.rows.length === 0 ? (
                <EmptyState icon="bi-check-circle" title="Every in-service device is assigned" />
              ) : (
                <div className="table-responsive" style={{ maxHeight: 340 }}>
                  <table className="table table-sm mb-0">
                    <caption className="visually-hidden">Assets in service with no assignment</caption>
                    <thead className="table-light table-sticky">
                      <tr>
                        <th scope="col">Tag</th>
                        <th scope="col">Type</th>
                        <th scope="col">Country</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unassignedAssets.rows.map((asset) => (
                        <tr key={asset.id}>
                          <th scope="row" className="fw-normal">
                            <Link href={`/assets/${asset.id}/`}>{asset.assetTag ?? `#${asset.id}`}</Link>
                          </th>
                          <td className="small">{ASSET_CATEGORY_LABELS[asset.category]}</td>
                          <td className="small">{countryName(asset.site)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {unassignedAssets.total > unassignedAssets.rows.length && (
                <div className="card-body py-2">
                  <Link className="small" href="/assets/?unassigned=1">
                    See all {unassignedAssets.total} unassigned devices
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">Possible duplicate employees ({duplicates.length})</div>
            <div className="card-body p-0">
              {duplicates.length === 0 ? (
                <EmptyState icon="bi-check-circle" title="No duplicates detected" />
              ) : (
                <div className="table-responsive" style={{ maxHeight: 340 }}>
                  <table className="table table-sm mb-0">
                    <caption className="visually-hidden">Employees that may be duplicates</caption>
                    <thead className="table-light table-sticky">
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Email</th>
                        <th scope="col">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {duplicates.map((row) => (
                        <tr key={row.id}>
                          <th scope="row" className="fw-normal">
                            <Link href={`/employees/${row.id}/`}>{row.full_name}</Link>
                          </th>
                          <td className="small">{row.email}</td>
                          <td className="small text-secondary">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">Asset tag mismatches ({mismatches.length})</div>
            <div className="card-body p-0">
              {mismatches.length === 0 ? (
                <EmptyState icon="bi-check-circle" title="Every tag agrees with its record" />
              ) : (
                <div className="table-responsive" style={{ maxHeight: 340 }}>
                  <table className="table table-sm mb-0">
                    <caption className="visually-hidden">Assets whose tag disagrees with the record</caption>
                    <thead className="table-light table-sticky">
                      <tr>
                        <th scope="col">Tag</th>
                        <th scope="col">Discrepancy</th>
                        <th scope="col">Expected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mismatches.map(({ row, message }) => (
                        <tr key={row.id}>
                          <th scope="row" className="fw-normal">
                            <Link href={`/assets/${row.id}/`}>{row.assetTag}</Link>
                          </th>
                          <td className="small">{message}</td>
                          <td className="small text-secondary">
                            <code>{expectedTagPrefix(row) ?? "—"}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
