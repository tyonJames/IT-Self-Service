import type { Metadata } from "next";
import Link from "next/link";
import type { EquipmentStatus } from "@prisma/client";
import { requireAgent } from "@/lib/permissions";
import { equipmentRepository, type EquipmentFilters } from "@/repositories/equipment.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { equipmentFilterSchema } from "@/lib/validation/equipment";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { countryColour, countryName, COUNTRY_CODES } from "@/lib/config/countries";
import {
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_ICONS,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUS_VARIANTS,
  OPEN_EQUIPMENT_STATUSES,
} from "@/lib/domain/equipment-status";
import { formatDate, formatRelative } from "@/lib/utils/format";
import { EmptyState, PageHeader, Pagination, StatTile } from "@/components/ui";

export const metadata: Metadata = { title: "Equipment requests" };
export const dynamic = "force-dynamic";

/** `/equipment/` — the agent request queue (spec §5.13). */
export default async function EquipmentQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/equipment/");

  const raw = await searchParams;
  const query = equipmentFilterSchema.parse(raw);
  const page = parsePageRequest(raw as { page?: string });

  const filters: EquipmentFilters = {
    status: (query.status as EquipmentStatus | undefined) ?? null,
    openness: query.openness,
    country: query.country ?? null,
    priority: query.priority ?? null,
    search: query.q ?? null,
  };

  const [{ rows, total }, itemLabels, statusCounts] = await Promise.all([
    equipmentRepository.list(filters, page),
    lookupRepository.equipmentItemTypeLabels(),
    equipmentRepository.countByStatus(),
  ]);

  const result = paginate(rows, total, page);

  const counts = new Map(statusCounts.map((s) => [s.status, s._count._all]));
  const openTotal = OPEN_EQUIPMENT_STATUSES.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);
  const urgentOpen = await equipmentRepository.count({
    isDeleted: false,
    priority: "urgent",
    status: { in: OPEN_EQUIPMENT_STATUSES },
  });

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "page") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) params[key] = v;
  }

  return (
    <>
      <PageHeader
        title="Equipment requests"
        icon="bi-box-seam"
        subtitle="What people have asked for, and where each request has got to"
      />

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3">
          <StatTile label="Open" value={openTotal} icon="bi-inbox" variant="dark" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile
            label="Urgent and open"
            value={urgentOpen}
            icon="bi-lightning-charge"
            variant={urgentOpen > 0 ? "danger" : "success"}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile label="Awaiting review" value={counts.get("submitted") ?? 0} icon="bi-search" variant="primary" />
        </div>
        <div className="col-6 col-lg-3">
          <StatTile label="Approved, not issued" value={(counts.get("approved") ?? 0) + (counts.get("ordered") ?? 0)} icon="bi-truck" variant="warning" />
        </div>
      </div>

      <form method="get" action="/equipment/" className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-4 col-lg-3">
              <label className="form-label small mb-1" htmlFor="q">
                Search
              </label>
              <input
                className="form-control form-control-sm"
                type="search"
                id="q"
                name="q"
                defaultValue={query.q ?? ""}
                placeholder="#12, name, email, reason…"
                maxLength={200}
              />
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <label className="form-label small mb-1" htmlFor="openness">
                Show
              </label>
              <select
                className="form-select form-select-sm"
                id="openness"
                name="openness"
                defaultValue={query.openness}
              >
                <option value="open">Open requests</option>
                <option value="closed">Closed requests</option>
                <option value="all">Everything</option>
              </select>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <label className="form-label small mb-1" htmlFor="status">
                Status
              </label>
              <select
                className="form-select form-select-sm"
                id="status"
                name="status"
                defaultValue={query.status ?? ""}
              >
                <option value="">Any status</option>
                {EQUIPMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {EQUIPMENT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <label className="form-label small mb-1" htmlFor="country">
                Country
              </label>
              <select
                className="form-select form-select-sm"
                id="country"
                name="country"
                defaultValue={query.country ?? ""}
              >
                <option value="">All countries</option>
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <label className="form-label small mb-1" htmlFor="priority">
                Priority
              </label>
              <select
                className="form-select form-select-sm"
                id="priority"
                name="priority"
                defaultValue={query.priority ?? ""}
              >
                <option value="">Any</option>
                <option value="urgent">Urgent</option>
                <option value="normal">Normal</option>
              </select>
            </div>
            <div className="col-auto">
              <button type="submit" className="btn btn-sm btn-primary">
                <i className="bi bi-funnel me-1" aria-hidden="true" />
                Filter
              </button>
            </div>
            <div className="col-auto">
              <Link className="btn btn-sm btn-outline-secondary" href="/equipment/">
                Clear
              </Link>
            </div>
          </div>
        </div>
      </form>

      {result.items.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <EmptyState
              icon="bi-box"
              title="No requests match these filters"
              hint="Requests arrive from the public portal at /request-equipment/."
            />
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <caption className="visually-hidden">
                Equipment requests, page {result.page} of {result.totalPages}
              </caption>
              <thead className="table-light">
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Requester</th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Items
                  </th>
                  <th scope="col" className="d-none d-md-table-cell">
                    Country
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="d-none d-xl-table-cell">
                    Raised
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((request) => {
                  const items = request.items.map((item) => {
                    const label = itemLabels.get(item.item) ?? item.item;
                    return item.quantity > 1 ? `${item.quantity} × ${label}` : label;
                  });
                  if (request.otherEquipment) items.push(request.otherEquipment);

                  return (
                    <tr key={request.id}>
                      <th scope="row" className="fw-normal">
                        <span
                          className="country-accent ps-2 d-inline-block"
                          style={{ ["--country-accent" as string]: countryColour(request.country) }}
                        >
                          <Link className="text-decoration-none fw-semibold" href={`/equipment/${request.id}/`}>
                            #{request.id}
                          </Link>
                          {request.priority === "urgent" && (
                            <span className="badge bg-danger ms-2">Urgent</span>
                          )}
                        </span>
                      </th>
                      <td className="small">
                        {request.employee ? (
                          <Link href={`/employees/${request.employee.id}/`}>
                            {request.employee.fullName}
                          </Link>
                        ) : (
                          request.requesterName
                        )}
                        <div className="text-secondary">{request.department || request.requesterEmail}</div>
                      </td>
                      <td className="small d-none d-lg-table-cell">
                        {items.length > 0 ? items.join(", ") : <span className="text-secondary">—</span>}
                      </td>
                      <td className="small d-none d-md-table-cell">
                        {countryName(request.country)}
                        {request.siteName && <div className="text-secondary">{request.siteName}</div>}
                      </td>
                      <td>
                        <span className={`badge bg-${EQUIPMENT_STATUS_VARIANTS[request.status]}`}>
                          <i
                            className={`bi ${EQUIPMENT_STATUS_ICONS[request.status]} me-1`}
                            aria-hidden="true"
                          />
                          {EQUIPMENT_STATUS_LABELS[request.status]}
                        </span>
                      </td>
                      <td className="small text-secondary d-none d-xl-table-cell">
                        <span title={formatDate(request.createdAt)}>
                          {formatRelative(request.createdAt)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination result={result} baseUrl="/equipment/" params={params} itemLabel="requests" />
    </>
  );
}
