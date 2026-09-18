import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { reportService, resolvePeriod } from "@/services/report.service";
import { humaniseDuration } from "@/lib/sla/workhours";
import { formatPercent } from "@/lib/utils/format";
import { countryColour, countryName, COUNTRY_CODES } from "@/lib/config/countries";
import { TICKET_PRIORITY_LABELS } from "@/lib/domain/tickets";
import { PageHeader, StatTile } from "@/components/ui";
import { ReportFilters } from "@/components/dashboard/ReportFilters";

export const metadata: Metadata = { title: "Period report" };
export const dynamic = "force-dynamic";

/** `/tickets/reports/period/` — detailed metrics for a date range (spec §5.4). */
export default async function PeriodReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/tickets/reports/period/");

  const params = await searchParams;
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const period = resolvePeriod(first(params.period), first(params.from), first(params.to));
  const rawCountry = first(params.country);
  const country =
    rawCountry && (COUNTRY_CODES as readonly string[]).includes(rawCountry) ? rawCountry : null;

  const report = await reportService.periodReport(period, country);

  const exportQuery = new URLSearchParams();
  if (first(params.period)) exportQuery.set("period", first(params.period)!);
  if (first(params.from)) exportQuery.set("from", first(params.from)!);
  if (first(params.to)) exportQuery.set("to", first(params.to)!);
  if (country) exportQuery.set("country", country);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/tickets/reports/">Command Centre</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Period report
          </li>
        </ol>
      </nav>

      <PageHeader
        title="Period report"
        icon="bi-calendar-range"
        subtitle={`${period.label}${country ? ` · ${countryName(country)}` : " · all countries"}. All durations are working hours.`}
        actions={
          <>
            <Link
              className="btn btn-outline-secondary btn-sm"
              href={`/tickets/export/excel/?${exportQuery.toString()}`}
            >
              <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
              Excel
            </Link>
            <Link
              className="btn btn-outline-secondary btn-sm"
              href={`/tickets/export/pdf/?${exportQuery.toString()}`}
            >
              <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true" />
              PDF
            </Link>
          </>
        }
      />

      <ReportFilters
        basePath="/tickets/reports/period/"
        period={period.key}
        from={first(params.from) ?? ""}
        to={first(params.to) ?? ""}
        country={country ?? ""}
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3">
          <StatTile label="Raised" value={report.total} icon="bi-inbox" variant="dark" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile label="Resolved" value={report.resolved} icon="bi-check-circle" variant="success" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="Still open"
            value={report.stillOpen}
            icon="bi-hourglass-split"
            variant={report.stillOpen > 0 ? "warning" : "success"}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="SLA compliance"
            value={formatPercent(report.compliance)}
            icon="bi-patch-check"
            variant={
              report.compliance === null
                ? "secondary"
                : report.compliance >= 90
                  ? "success"
                  : report.compliance >= 75
                    ? "warning"
                    : "danger"
            }
          />
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3">
          <StatTile label="Average to resolve" value={humaniseDuration(report.averageHours)} icon="bi-stopwatch" variant="dark" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="Median to resolve"
            value={humaniseDuration(report.medianHours)}
            icon="bi-graph-up"
            variant="dark"
            hint="Half were faster than this"
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile label="Fastest" value={humaniseDuration(report.fastestHours)} icon="bi-lightning" variant="success" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile label="Slowest" value={humaniseDuration(report.slowestHours)} icon="bi-hourglass" variant="danger" />
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-header">SLA by priority</div>
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <caption className="visually-hidden">SLA compliance by priority for {period.label}</caption>
            <thead className="table-light">
              <tr>
                <th scope="col">Priority</th>
                <th scope="col" className="text-end">Target</th>
                <th scope="col" className="text-end">Tickets</th>
                <th scope="col" className="text-end">Met</th>
                <th scope="col" className="text-end">Breached</th>
                <th scope="col" className="text-end">Compliance</th>
              </tr>
            </thead>
            <tbody>
              {report.slaTable.map((row) => (
                <tr key={row.priority}>
                  <th scope="row" className="fw-normal">
                    {TICKET_PRIORITY_LABELS[row.priority]}
                  </th>
                  <td className="text-end">{row.targetHours}h</td>
                  <td className="text-end">{row.total}</td>
                  <td className="text-end text-success">{row.met}</td>
                  <td className="text-end text-danger">{row.breached}</td>
                  <td className="text-end">{formatPercent(row.compliancePercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">By country</div>
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <caption className="visually-hidden">Ticket performance by country for {period.label}</caption>
            <thead className="table-light">
              <tr>
                <th scope="col">Country</th>
                <th scope="col" className="text-end">Raised</th>
                <th scope="col" className="text-end">Resolved</th>
                <th scope="col" className="text-end">Average</th>
                <th scope="col" className="text-end">Median</th>
                <th scope="col" className="text-end">Compliance</th>
              </tr>
            </thead>
            <tbody>
              {report.byCountry.map((row) => (
                <tr key={row.code}>
                  <th scope="row" className="fw-normal">
                    <span
                      className="country-accent ps-2 d-inline-block"
                      style={{ ["--country-accent" as string]: countryColour(row.code) }}
                    >
                      {countryName(row.code)}
                    </span>
                  </th>
                  <td className="text-end">{row.total}</td>
                  <td className="text-end">{row.resolved}</td>
                  <td className="text-end">{humaniseDuration(row.averageHours)}</td>
                  <td className="text-end">{humaniseDuration(row.medianHours)}</td>
                  <td className="text-end">
                    {row.compliance === null ? (
                      <span className="text-secondary">—</span>
                    ) : (
                      <span
                        className={`badge bg-${row.compliance >= 90 ? "success" : row.compliance >= 75 ? "warning" : "danger"}`}
                      >
                        {formatPercent(row.compliance)}
                      </span>
                    )}
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
