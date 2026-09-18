import type { Metadata } from "next";
import Link from "next/link";
import type { TicketPriority, TicketStatus } from "@prisma/client";
import { requireAuthenticatedUser, isAgentOrAdmin } from "@/lib/permissions";
import { ticketRepository, type TicketFilters, type TicketSort } from "@/repositories/ticket.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { userService } from "@/services/user.service";
import { ticketFilterSchema } from "@/lib/validation/tickets";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { countryColour, countryName } from "@/lib/config/countries";
import { evaluateSla } from "@/lib/sla/sla";
import { formatDateTime, truncate } from "@/lib/utils/format";
import {
  ticketReference,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_VARIANTS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANTS,
  OPEN_TICKET_STATUSES,
} from "@/lib/domain/tickets";
import { EmptyState, PageHeader, Pagination } from "@/components/ui";
import { TicketFilters as TicketFilterBar } from "@/components/tickets/TicketFilters";

export const metadata: Metadata = { title: "Tickets" };
export const dynamic = "force-dynamic";

/** `/tickets/` — filterable, sortable, paginated ticket list (spec §5.5). */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAuthenticatedUser("/tickets/");
  const agent = isAgentOrAdmin(session.user.role);

  const raw = await searchParams;
  const query = ticketFilterSchema.parse(raw);
  const page = parsePageRequest(raw as { page?: string });

  // Staff never see anyone else's tickets — the constraint is applied in SQL,
  // not just in the UI (instruction §8).
  const visibleToUser = agent
    ? null
    : { userId: session.user.id, email: session.user.email };

  const filters: TicketFilters = {
    priority: (query.priority as TicketPriority | undefined) ?? null,
    category: query.category ?? null,
    country: agent ? (query.country ?? null) : null,
    search: query.q ?? null,
    visibleToUser,
  };

  switch (query.tab) {
    case "open":
      filters.statusIn = OPEN_TICKET_STATUSES;
      break;
    case "mine":
      filters.assignedToId = agent ? session.user.id : null;
      if (!agent) filters.visibleToUser = visibleToUser;
      break;
    case "overdue":
      filters.overdueOnly = true;
      break;
    case "resolved":
      filters.statusIn = ["resolved", "closed"];
      break;
    default:
      break;
  }

  if (query.status) filters.status = query.status as TicketStatus;

  if (agent && raw.assignedTo) {
    const value = Array.isArray(raw.assignedTo) ? raw.assignedTo[0] : raw.assignedTo;
    if (value === "none") filters.unassignedOnly = true;
    else if (value) {
      const id = Number.parseInt(value, 10);
      if (Number.isSafeInteger(id) && id > 0) filters.assignedToId = id;
    }
  }

  const [{ rows, total }, categories, agents] = await Promise.all([
    ticketRepository.list(filters, page, query.sort as TicketSort, query.dir),
    lookupRepository.ticketCategoryLabels(),
    agent ? userService.assignableAgents() : Promise.resolve([]),
  ]);

  const result = paginate(rows, total, page);

  const paginationParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "page") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) paginationParams[key] = v;
  }

  const sortHref = (column: TicketSort): string => {
    const params = new URLSearchParams(paginationParams);
    params.set("sort", column);
    params.set("dir", query.sort === column && query.dir === "asc" ? "desc" : "asc");
    return `/tickets/?${params.toString()}`;
  };

  const sortIcon = (column: TicketSort): string =>
    query.sort !== column ? "bi-arrow-down-up opacity-25" : query.dir === "asc" ? "bi-sort-up" : "bi-sort-down";

  return (
    <>
      <PageHeader
        title="Tickets"
        icon="bi-ticket-detailed"
        subtitle={agent ? "Every request across the group" : "Requests you have raised"}
        actions={
          agent ? (
            <>
              <Link className="btn btn-outline-secondary btn-sm" href={`/tickets/export/excel/?${new URLSearchParams(paginationParams)}`}>
                <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
                Excel
              </Link>
              <Link className="btn btn-outline-secondary btn-sm" href={`/tickets/export/pdf/?${new URLSearchParams(paginationParams)}`}>
                <i className="bi bi-file-earmark-pdf me-1" aria-hidden="true" />
                PDF
              </Link>
              <Link className="btn btn-primary btn-sm" href="/report/">
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                Log a ticket
              </Link>
            </>
          ) : (
            <Link className="btn btn-primary btn-sm" href="/report/">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Report a problem
            </Link>
          )
        }
      />

      <TicketFilterBar
        tab={query.tab}
        status={query.status}
        priority={query.priority}
        category={query.category}
        country={query.country}
        assignedTo={Array.isArray(raw.assignedTo) ? raw.assignedTo[0] : raw.assignedTo}
        q={query.q}
        categories={[...categories.entries()].map(([value, label]) => ({ value, label }))}
        agents={agents.map((a) => ({
          id: a.id,
          label: `${a.firstName} ${a.lastName}`.trim() || a.username,
        }))}
        showAgentFilters={agent}
      />

      <div className="card">
        {result.items.length === 0 ? (
          <div className="card-body">
            <EmptyState
              icon="bi-inbox"
              title="No tickets match these filters"
              hint={
                query.q
                  ? `Nothing found for “${query.q}”. Try a different search or clear the filters.`
                  : "Change the filters above, or check another tab."
              }
              action={
                <Link className="btn btn-outline-primary btn-sm" href="/tickets/">
                  Clear filters
                </Link>
              }
            />
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <caption className="visually-hidden">
                Ticket list, page {result.page} of {result.totalPages}
              </caption>
              <thead className="table-light">
                <tr>
                  <th scope="col" style={{ width: "6.5rem" }}>
                    Reference
                  </th>
                  <th scope="col">
                    <Link className="text-decoration-none text-body" href={sortHref("title")}>
                      Title <i className={`bi ${sortIcon("title")}`} aria-hidden="true" />
                    </Link>
                  </th>
                  <th scope="col">
                    <Link className="text-decoration-none text-body" href={sortHref("status")}>
                      Status <i className={`bi ${sortIcon("status")}`} aria-hidden="true" />
                    </Link>
                  </th>
                  <th scope="col">
                    <Link className="text-decoration-none text-body" href={sortHref("priority")}>
                      Priority <i className={`bi ${sortIcon("priority")}`} aria-hidden="true" />
                    </Link>
                  </th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Category
                  </th>
                  <th scope="col" className="d-none d-md-table-cell">
                    Reporter
                  </th>
                  {agent && (
                    <th scope="col" className="d-none d-lg-table-cell">
                      Assigned
                    </th>
                  )}
                  <th scope="col" className="d-none d-xl-table-cell">
                    <Link className="text-decoration-none text-body" href={sortHref("createdAt")}>
                      Raised <i className={`bi ${sortIcon("createdAt")}`} aria-hidden="true" />
                    </Link>
                  </th>
                  <th scope="col">
                    <Link className="text-decoration-none text-body" href={sortHref("dueDate")}>
                      SLA <i className={`bi ${sortIcon("dueDate")}`} aria-hidden="true" />
                    </Link>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((ticket) => {
                  const sla = evaluateSla({ dueDate: ticket.dueDate, resolvedAt: ticket.resolvedAt });
                  return (
                    <tr key={ticket.id}>
                      <th scope="row" className="fw-normal">
                        <span
                          className="country-accent ps-2 d-inline-block"
                          style={{ ["--country-accent" as string]: countryColour(ticket.country) }}
                          title={countryName(ticket.country)}
                        >
                          <Link className="text-decoration-none fw-semibold" href={`/tickets/${ticket.id}/`}>
                            {ticketReference(ticket.id)}
                          </Link>
                        </span>
                      </th>
                      <td>
                        <Link className="text-decoration-none text-body" href={`/tickets/${ticket.id}/`}>
                          {truncate(ticket.title, 70)}
                        </Link>
                        {ticket.siteName && (
                          <div className="small text-secondary d-lg-none">{ticket.siteName}</div>
                        )}
                      </td>
                      <td>
                        <span className={`badge bg-${TICKET_STATUS_VARIANTS[ticket.status]}`}>
                          {TICKET_STATUS_LABELS[ticket.status]}
                        </span>
                      </td>
                      <td>
                        <span className={`badge bg-${TICKET_PRIORITY_VARIANTS[ticket.priority]}`}>
                          {TICKET_PRIORITY_LABELS[ticket.priority]}
                        </span>
                      </td>
                      <td className="d-none d-lg-table-cell small">
                        {categories.get(ticket.category) ?? ticket.category}
                      </td>
                      <td className="d-none d-md-table-cell small">
                        {ticket.employee?.fullName ?? ticket.submitterName ?? "—"}
                        <div className="text-secondary">{countryName(ticket.country)}</div>
                      </td>
                      {agent && (
                        <td className="d-none d-lg-table-cell small">
                          {ticket.assignedTo
                            ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`.trim() ||
                              ticket.assignedTo.username
                            : <span className="text-warning">Unassigned</span>}
                        </td>
                      )}
                      <td className="d-none d-xl-table-cell small text-secondary">
                        {formatDateTime(ticket.createdAt)}
                      </td>
                      <td className="small">
                        {ticket.dueDate ? (
                          <span className={`text-${sla.variant === "success" ? "success" : sla.variant}`}>
                            <i
                              className={`bi ${sla.isOverdue ? "bi-alarm" : "bi-clock"} me-1`}
                              aria-hidden="true"
                            />
                            {sla.label}
                          </span>
                        ) : (
                          <span className="text-secondary">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination result={result} baseUrl="/tickets/" params={paginationParams} itemLabel="tickets" />
    </>
  );
}
