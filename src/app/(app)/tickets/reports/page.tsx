import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { reportService, resolvePeriod } from "@/services/report.service";
import { humaniseDuration } from "@/lib/sla/workhours";
import { formatPercent } from "@/lib/utils/format";
import { countryColour, countryName, COUNTRY_CODES } from "@/lib/config/countries";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANTS,
} from "@/lib/domain/tickets";
import { PageHeader, StatTile } from "@/components/ui";
import { BarChart, DoughnutChart, TrendChart } from "@/components/dashboard/Charts";
import { ReportFilters } from "@/components/dashboard/ReportFilters";
import type { TicketStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Command Centre" };
export const dynamic = "force-dynamic";

const STATUS_COLOURS: Record<string, string> = {
  open: "#dc3545",
  in_progress: "#ffc107",
  waiting: "#0dcaf0",
  resolved: "#2d7a45",
  closed: "#6c757d",
};

/**
 * `/tickets/reports/` — the Command Centre dashboard (spec §5.4).
 * Also the post-login landing page (spec note 13).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/tickets/reports/");

  const params = await searchParams;
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const period = resolvePeriod(first(params.period), first(params.from), first(params.to));
  const rawCountry = first(params.country);
  const country =
    rawCountry && (COUNTRY_CODES as readonly string[]).includes(rawCountry) ? rawCountry : null;

  const data = await reportService.dashboard(period, country);

  const { summary } = data;

  return (
    <>
      <PageHeader
        title="Command Centre"
        icon="bi-speedometer2"
        subtitle={`${period.label}${country ? ` · ${countryName(country)}` : " · all countries"}`}
        actions={
          <>
            <Link className="btn btn-outline-secondary btn-sm" href="/tickets/reports/assets/">
              <i className="bi bi-hdd-stack me-1" aria-hidden="true" />
              Asset report
            </Link>
            <Link className="btn btn-outline-secondary btn-sm" href="/tickets/reports/period/">
              <i className="bi bi-calendar-range me-1" aria-hidden="true" />
              Period report
            </Link>
            <Link className="btn btn-outline-secondary btn-sm" href="/tickets/reports/notifications/">
              <i className="bi bi-envelope-paper me-1" aria-hidden="true" />
              Email log
            </Link>
          </>
        }
      />

      <ReportFilters
        basePath="/tickets/reports/"
        period={period.key}
        from={first(params.from) ?? ""}
        to={first(params.to) ?? ""}
        country={country ?? ""}
      />

      {/* Zone 1 — summary tiles */}
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3">
          <Link href="/tickets/?tab=open" className="text-decoration-none">
            <StatTile
              label="Open tickets"
              value={summary.openTickets.toLocaleString()}
              icon="bi-ticket-detailed"
              variant={summary.openTickets > 0 ? "dark" : "success"}
              hint={`${summary.unassigned} unassigned`}
            />
          </Link>
        </div>
        <div className="col-6 col-lg-3">
          <Link href="/tickets/?tab=overdue" className="text-decoration-none">
            <StatTile
              label="Overdue"
              value={summary.overdueTickets.toLocaleString()}
              icon="bi-alarm"
              variant={summary.overdueTickets > 0 ? "danger" : "success"}
              hint="Past SLA and still open"
            />
          </Link>
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="Avg resolution"
            value={humaniseDuration(summary.averageResolutionHours)}
            icon="bi-stopwatch"
            variant="dark"
            hint={
              summary.medianResolutionHours !== null
                ? `Median ${humaniseDuration(summary.medianResolutionHours)}`
                : "No resolved tickets yet"
            }
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="SLA compliance"
            value={formatPercent(summary.slaCompliance)}
            icon="bi-patch-check"
            variant={
              summary.slaCompliance === null
                ? "secondary"
                : summary.slaCompliance >= 90
                  ? "success"
                  : summary.slaCompliance >= 75
                    ? "warning"
                    : "danger"
            }
            hint={`${summary.resolvedInPeriod} of ${summary.totalInPeriod} resolved`}
          />
        </div>
      </div>

      {/* Zone 2 — charts */}
      <div className="row g-3 mb-3">
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header">Tickets by status</div>
            <div className="card-body">
              <DoughnutChart
                title="Tickets by status"
                data={data.byStatus.map((s) => ({
                  key: s.key,
                  label: TICKET_STATUS_LABELS[s.key as TicketStatus] ?? s.label,
                  count: s.count,
                  colour: STATUS_COLOURS[s.key],
                }))}
              />
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header">Tickets by category</div>
            <div className="card-body">
              <BarChart title="Tickets by category" data={data.byCategory} horizontal />
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header">By country</div>
            <div className="card-body">
              <DoughnutChart
                title="Tickets by country"
                data={data.byCountry.map((c) => ({
                  key: c.key,
                  label: countryName(c.key),
                  count: c.count,
                  colour: countryColour(c.key),
                }))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-header">Raised vs resolved</div>
        <div className="card-body">
          <TrendChart title="Tickets raised and resolved per day" points={data.trend} />
        </div>
      </div>

      {/* Zone 3 — SLA table */}
      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <span>SLA performance by priority</span>
          <span className="small text-secondary fw-normal">Targets are working hours, Mon–Fri 08:00–17:00</span>
        </div>
        <div className="table-responsive">
          <table className="table table-sm mb-0 align-middle">
            <caption className="visually-hidden">
              SLA compliance broken down by ticket priority for {period.label}
            </caption>
            <thead className="table-light">
              <tr>
                <th scope="col">Priority</th>
                <th scope="col" className="text-end">
                  Target
                </th>
                <th scope="col" className="text-end">
                  Tickets
                </th>
                <th scope="col" className="text-end">
                  Met
                </th>
                <th scope="col" className="text-end">
                  Breached
                </th>
                <th scope="col" style={{ minWidth: 160 }}>
                  Compliance
                </th>
              </tr>
            </thead>
            <tbody>
              {data.slaTable.map((row) => (
                <tr key={row.priority}>
                  <th scope="row" className="fw-normal">
                    <span className={`badge bg-${TICKET_STATUS_VARIANTS.open === "danger" && row.priority === "critical" ? "danger" : row.priority === "high" ? "warning" : row.priority === "medium" ? "primary" : "secondary"}`}>
                      {TICKET_PRIORITY_LABELS[row.priority]}
                    </span>
                  </th>
                  <td className="text-end">{row.targetHours}h</td>
                  <td className="text-end">{row.total}</td>
                  <td className="text-end text-success">{row.met}</td>
                  <td className="text-end text-danger">{row.breached}</td>
                  <td>
                    {row.compliancePercent === null ? (
                      <span className="text-secondary small">Nothing resolved yet</span>
                    ) : (
                      <div className="d-flex align-items-center gap-2">
                        <div className="progress flex-grow-1" style={{ height: 8 }}>
                          <div
                            className={`progress-bar bg-${row.compliancePercent >= 90 ? "success" : row.compliancePercent >= 75 ? "warning" : "danger"}`}
                            style={{ width: `${Math.min(100, row.compliancePercent)}%` }}
                            role="progressbar"
                            aria-valuenow={Math.round(row.compliancePercent)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${TICKET_PRIORITY_LABELS[row.priority]} compliance`}
                          />
                        </div>
                        <span className="small" style={{ minWidth: "3.5rem" }}>
                          {formatPercent(row.compliancePercent)}
                        </span>
                      </div>
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
