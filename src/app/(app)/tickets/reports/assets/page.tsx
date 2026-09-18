import type { Metadata } from "next";
import Link from "next/link";
import type { AssetCategory, AssetStatus } from "@prisma/client";
import { requireAgent } from "@/lib/permissions";
import { reportService } from "@/services/report.service";
import { countryColour, countryName, COUNTRY_CODES } from "@/lib/config/countries";
import {
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANTS,
} from "@/lib/domain/assets";
import { PageHeader, StatTile } from "@/components/ui";
import { BarChart, DoughnutChart } from "@/components/dashboard/Charts";

export const metadata: Metadata = { title: "Asset report" };
export const dynamic = "force-dynamic";

const STATUS_COLOURS: Record<string, string> = {
  active: "#2d7a45",
  faulty: "#dc3545",
  repair: "#ffc107",
  retired: "#6c757d",
  spare: "#0dcaf0",
  return_pending: "#fd7e14",
  stolen: "#212529",
};

/** `/tickets/reports/assets/` — the asset breakdown tab (spec §5.4). */
export default async function AssetReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/tickets/reports/assets/");

  const params = await searchParams;
  const raw = Array.isArray(params.country) ? params.country[0] : params.country;
  const country = raw && (COUNTRY_CODES as readonly string[]).includes(raw) ? raw : null;

  const data = await reportService.assetBreakdown(country);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/tickets/reports/">Command Centre</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Asset report
          </li>
        </ol>
      </nav>

      <PageHeader
        title="Asset report"
        icon="bi-hdd-stack"
        subtitle={country ? countryName(country) : "All countries"}
        actions={
          <div className="btn-group btn-group-sm">
            <Link
              className={`btn btn-outline-secondary${country ? "" : " active"}`}
              href="/tickets/reports/assets/"
            >
              All
            </Link>
            {COUNTRY_CODES.map((code) => (
              <Link
                key={code}
                className={`btn btn-outline-secondary${country === code ? " active" : ""}`}
                href={`/tickets/reports/assets/?country=${code}`}
              >
                {code}
              </Link>
            ))}
          </div>
        }
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-4">
          <StatTile label="Total on record" value={data.total} icon="bi-hdd-stack" variant="dark" />
        </div>
        <div className="col-6 col-lg-4">
          <StatTile
            label="In service"
            value={data.inService}
            icon="bi-check-circle"
            variant="success"
            hint="Excludes retired and stolen"
          />
        </div>
        <div className="col-6 col-lg-4">
          <StatTile
            label="Tracked devices"
            value={data.tracked}
            icon="bi-broadcast"
            variant="info"
            hint="Running the check-in agent"
          />
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">By type</div>
            <div className="card-body">
              <BarChart
                title="Assets by type"
                horizontal
                data={data.byCategory.map((row) => ({
                  key: row.key,
                  label: ASSET_CATEGORY_LABELS[row.key as AssetCategory] ?? row.key,
                  count: row.count,
                }))}
              />
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">By status</div>
            <div className="card-body">
              <DoughnutChart
                title="Assets by status"
                data={data.byStatus.map((row) => ({
                  key: row.key,
                  label: ASSET_STATUS_LABELS[row.key as AssetStatus] ?? row.key,
                  count: row.count,
                  colour: STATUS_COLOURS[row.key],
                }))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">By country</div>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <caption className="visually-hidden">Assets by country</caption>
                <thead className="table-light">
                  <tr>
                    <th scope="col">Country</th>
                    <th scope="col" className="text-end">
                      Assets
                    </th>
                    <th scope="col" className="text-end">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCountry.map((row) => {
                    const totalAll = data.byCountry.reduce((sum, r) => sum + r.count, 0);
                    const share = totalAll > 0 ? (row.count / totalAll) * 100 : 0;
                    return (
                      <tr key={row.key}>
                        <th scope="row" className="fw-normal">
                          <span
                            className="country-accent ps-2 d-inline-block"
                            style={{ ["--country-accent" as string]: countryColour(row.key) }}
                          >
                            <Link href={`/assets/?country=${row.key}`}>{countryName(row.key)}</Link>
                          </span>
                        </th>
                        <td className="text-end">{row.count}</td>
                        <td className="text-end small text-secondary">{share.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100">
            <div className="card-header">Status detail</div>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <caption className="visually-hidden">Assets by status with links</caption>
                <thead className="table-light">
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-end">
                      Assets
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStatus.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="fw-normal">
                        <span className={`badge bg-${ASSET_STATUS_VARIANTS[row.key as AssetStatus]}`}>
                          {ASSET_STATUS_LABELS[row.key as AssetStatus] ?? row.key}
                        </span>
                      </th>
                      <td className="text-end">
                        <Link
                          href={`/assets/?status=${row.key}${country ? `&country=${country}` : ""}`}
                        >
                          {row.count}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-header">Type detail</div>
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <caption className="visually-hidden">Assets by type with links</caption>
            <thead className="table-light">
              <tr>
                <th scope="col">Type</th>
                <th scope="col" className="text-end">
                  Assets
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byCategory.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="fw-normal">
                    <i
                      className={`bi ${ASSET_CATEGORY_ICONS[row.key as AssetCategory]} me-2 text-secondary`}
                      aria-hidden="true"
                    />
                    {ASSET_CATEGORY_LABELS[row.key as AssetCategory] ?? row.key}
                  </th>
                  <td className="text-end">
                    <Link href={`/assets/?category=${row.key}${country ? `&country=${country}` : ""}`}>
                      {row.count}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
