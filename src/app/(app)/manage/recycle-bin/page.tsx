import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/permissions";
import { recycleBinService, type RecycleTab } from "@/services/recyclebin.service";
import { currentCsrfToken } from "@/lib/security/csrf";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { env } from "@/lib/config/env";
import { formatDateTime } from "@/lib/utils/format";
import { Alert, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { purgeRecord, restoreRecord } from "../actions";

export const metadata: Metadata = { title: "Recycle bin" };
export const dynamic = "force-dynamic";

const TABS: { key: RecycleTab; label: string; icon: string }[] = [
  { key: "assets", label: "Assets", icon: "bi-hdd-stack" },
  { key: "employees", label: "Employees", icon: "bi-people" },
  { key: "tickets", label: "Tickets", icon: "bi-ticket-detailed" },
  { key: "equipment", label: "Equipment requests", icon: "bi-box-seam" },
];

/** `/manage/recycle-bin/` — restore or purge soft-deleted records (spec §5.15). */
export default async function RecycleBinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAgent("/manage/recycle-bin/");
  const isAdmin = session.user.role === "admin";

  const raw = await searchParams;
  const tabParam = Array.isArray(raw.tab) ? raw.tab[0] : raw.tab;
  const tab: RecycleTab = TABS.some((t) => t.key === tabParam) ? (tabParam as RecycleTab) : "assets";

  const page = parsePageRequest(raw as { page?: string });

  const [{ rows, total }, counts, csrfToken] = await Promise.all([
    recycleBinService.list(tab, page.skip, page.take),
    recycleBinService.counts(),
    currentCsrfToken(),
  ]);

  const result = paginate(rows, total, page);
  const retentionDays = env().RECYCLE_BIN_RETENTION_DAYS;

  return (
    <>
      <PageHeader
        title="Recycle bin"
        icon="bi-trash3"
        subtitle={`Deleted records are kept for ${retentionDays} days, then removed automatically`}
      />

      <Alert variant="info" title="How deletion works here">
        Deleting hides a record from every list and report but keeps it in the database. Restoring
        brings it back exactly as it was. Purging is permanent and cannot be undone
        {isAdmin ? "." : " — and is restricted to administrators."}
      </Alert>

      <ul className="nav nav-tabs mb-3" role="tablist">
        {TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <Link
              className={`nav-link${t.key === tab ? " active" : ""}`}
              href={`/manage/recycle-bin/?tab=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
            >
              <i className={`bi ${t.icon} me-1`} aria-hidden="true" />
              {t.label}
              <span className="badge bg-secondary ms-2">{counts[t.key]}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="card">
        {result.items.length === 0 ? (
          <div className="card-body">
            <EmptyState
              icon="bi-check-circle"
              title="Nothing deleted here"
              hint={`No ${TABS.find((t) => t.key === tab)?.label.toLowerCase()} are in the recycle bin.`}
            />
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <caption className="visually-hidden">Deleted records in the recycle bin</caption>
              <thead className="table-light">
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col" className="d-none d-md-table-cell">
                    Deleted
                  </th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Deleted by
                  </th>
                  <th scope="col">Days left</th>
                  <th scope="col" className="text-end">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="fw-normal">
                      {row.label}
                      {row.sublabel && <div className="small text-secondary">{row.sublabel}</div>}
                    </th>
                    <td className="small text-secondary d-none d-md-table-cell">
                      {formatDateTime(row.deletedAt)}
                    </td>
                    <td className="small d-none d-lg-table-cell">{row.deletedBy}</td>
                    <td>
                      <span
                        className={`badge bg-${row.daysRemaining <= 3 ? "danger" : row.daysRemaining <= 7 ? "warning" : "secondary"}`}
                        title={`Purged automatically after ${retentionDays} days`}
                      >
                        {row.daysRemaining} day{row.daysRemaining === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="text-end text-nowrap">
                      <form action={restoreRecord} className="d-inline">
                        <input type="hidden" name="csrf_token" value={csrfToken} />
                        <input type="hidden" name="tab" value={tab} />
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" className="btn btn-sm btn-outline-success">
                          <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                          Restore
                        </button>
                      </form>

                      {isAdmin && (
                        <form action={purgeRecord} className="d-inline ms-1">
                          <input type="hidden" name="csrf_token" value={csrfToken} />
                          <input type="hidden" name="tab" value={tab} />
                          <input type="hidden" name="id" value={row.id} />
                          <button
                            type="submit"
                            className="btn btn-sm btn-outline-danger"
                            title="Permanently delete — this cannot be undone"
                          >
                            <i className="bi bi-x-octagon me-1" aria-hidden="true" />
                            Purge
                          </button>
                        </form>
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
        baseUrl="/manage/recycle-bin/"
        params={{ tab }}
        itemLabel="deleted records"
      />

      <p className="small text-secondary mt-3">
        Automatic purging runs from a scheduled job, not a cron process on the web server — see
        <code className="ms-1">AZURE_DEPLOYMENT.md §15</code> for how it is wired up.
      </p>
    </>
  );
}
