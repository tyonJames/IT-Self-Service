import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { notificationService, MAX_ATTEMPTS } from "@/services/notification.service";
import { currentCsrfToken } from "@/lib/security/csrf";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { formatDateTime, truncate } from "@/lib/utils/format";
import { ticketReference } from "@/lib/domain/tickets";
import { env } from "@/lib/config/env";
import { Alert, EmptyState, PageHeader, Pagination, StatTile } from "@/components/ui";
import { RetryAllPanel, RetryButton } from "@/components/dashboard/NotificationRetry";

export const metadata: Metadata = { title: "Email log" };
export const dynamic = "force-dynamic";

const STATUS_VARIANTS: Record<string, string> = {
  pending: "secondary",
  sent: "success",
  failed: "danger",
};

/**
 * `/tickets/reports/notifications/` — every email the system has tried to
 * send, with its outcome (spec §5.4, note 11).
 */
export default async function NotificationLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/tickets/reports/notifications/");

  const raw = await searchParams;
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const statusRaw = first(raw.status);
  const status =
    statusRaw === "pending" || statusRaw === "sent" || statusRaw === "failed" ? statusRaw : undefined;
  const search = first(raw.q) ?? "";
  const page = parsePageRequest(raw as { page?: string });

  const [{ rows, total }, counts, csrfToken] = await Promise.all([
    notificationService.list({ status, search: search || undefined }, page.skip, page.take),
    notificationService.statusCounts(),
    currentCsrfToken(),
  ]);

  const result = paginate(rows, total, page);
  const backend = env().EMAIL_BACKEND;

  const params: Record<string, string> = {};
  if (status) params.status = status;
  if (search) params.q = search;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/tickets/reports/">Command Centre</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Email log
          </li>
        </ol>
      </nav>

      <PageHeader
        title="Email log"
        icon="bi-envelope-paper"
        subtitle="Every email the system has attempted, and what happened to it"
        actions={<RetryAllPanel csrfToken={csrfToken} pending={counts.failed + counts.pending} />}
      />

      {backend !== "smtp" && (
        <Alert variant="warning" title={`Email backend is “${backend}”, not SMTP`}>
          Messages are being recorded but not actually delivered. Set <code>EMAIL_BACKEND=smtp</code>{" "}
          and the SMTP settings to send for real.
        </Alert>
      )}

      <div className="row g-3 mb-3">
        <div className="col-4">
          <Link href="/tickets/reports/notifications/?status=sent" className="text-decoration-none">
            <StatTile label="Sent" value={counts.sent} icon="bi-check-circle" variant="success" />
          </Link>
        </div>
        <div className="col-4">
          <Link href="/tickets/reports/notifications/?status=pending" className="text-decoration-none">
            <StatTile label="Pending" value={counts.pending} icon="bi-hourglass" variant="secondary" />
          </Link>
        </div>
        <div className="col-4">
          <Link href="/tickets/reports/notifications/?status=failed" className="text-decoration-none">
            <StatTile
              label="Failed"
              value={counts.failed}
              icon="bi-exclamation-octagon"
              variant={counts.failed > 0 ? "danger" : "success"}
              hint={`Retried up to ${MAX_ATTEMPTS} times`}
            />
          </Link>
        </div>
      </div>

      <form method="get" action="/tickets/reports/notifications/" className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-5">
              <label className="form-label small mb-1" htmlFor="q">
                Search
              </label>
              <input
                className="form-control form-control-sm"
                type="search"
                id="q"
                name="q"
                defaultValue={search}
                placeholder="Recipient or subject…"
                maxLength={200}
              />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small mb-1" htmlFor="status">
                Status
              </label>
              <select
                className="form-select form-select-sm"
                id="status"
                name="status"
                defaultValue={status ?? ""}
              >
                <option value="">Any status</option>
                <option value="sent">Sent</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div className="col-auto">
              <button type="submit" className="btn btn-sm btn-primary">
                <i className="bi bi-funnel me-1" aria-hidden="true" />
                Filter
              </button>
            </div>
            <div className="col-auto">
              <Link className="btn btn-sm btn-outline-secondary" href="/tickets/reports/notifications/">
                Clear
              </Link>
            </div>
          </div>
        </div>
      </form>

      <div className="card">
        {result.items.length === 0 ? (
          <div className="card-body">
            <EmptyState icon="bi-envelope" title="No emails match these filters" />
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <caption className="visually-hidden">Email notification log</caption>
              <thead className="table-light">
                <tr>
                  <th scope="col">Recipient</th>
                  <th scope="col">Subject</th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Kind
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="d-none d-md-table-cell">
                    Attempted
                  </th>
                  <th scope="col" className="text-end">
                    Retry
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.id.toString()}>
                    <th scope="row" className="fw-normal small">
                      {row.recipient}
                      {row.ticketId && (
                        <div className="text-secondary">
                          <Link href={`/tickets/${row.ticketId}/`}>{ticketReference(row.ticketId)}</Link>
                        </div>
                      )}
                    </th>
                    <td className="small">
                      {truncate(row.subject, 70)}
                      {row.lastError && (
                        <div className="text-danger small">{truncate(row.lastError, 120)}</div>
                      )}
                    </td>
                    <td className="small d-none d-lg-table-cell text-capitalize">
                      {row.kind.replace("_", " ")}
                    </td>
                    <td>
                      <span className={`badge bg-${STATUS_VARIANTS[row.status] ?? "secondary"}`}>
                        {row.status}
                      </span>
                      {row.attempts > 0 && (
                        <div className="small text-secondary">
                          {row.attempts}/{MAX_ATTEMPTS} attempt{row.attempts === 1 ? "" : "s"}
                        </div>
                      )}
                    </td>
                    <td className="small text-secondary d-none d-md-table-cell">
                      {formatDateTime(row.sentAt ?? row.createdAt)}
                    </td>
                    <td className="text-end">
                      {row.status === "sent" ? (
                        <span className="text-success small">
                          <i className="bi bi-check2" aria-hidden="true" /> Delivered
                        </span>
                      ) : (
                        <RetryButton
                          notificationId={row.id.toString()}
                          disabled={row.attempts >= MAX_ATTEMPTS}
                          csrfToken={csrfToken}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination
        result={result}
        baseUrl="/tickets/reports/notifications/"
        params={params}
        itemLabel="emails"
      />
    </>
  );
}
