"use client";

import Link from "next/link";
import { COUNTRY_CODES, COUNTRY_NAMES } from "@/lib/config/countries";
import {
  TICKET_LIST_TABS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
} from "@/lib/domain/tickets";
import type { TicketPriority, TicketStatus } from "@prisma/client";

/**
 * Ticket list filter bar (spec §5.5).
 *
 * A GET form, so filtering is a plain navigation: filters end up in the URL,
 * the server does the work, and the browser's back button behaves. Nothing is
 * filtered client-side — the page never holds more than one page of rows
 * (instruction §19).
 */
export function TicketFilters({
  tab,
  status,
  priority,
  category,
  country,
  assignedTo,
  q,
  categories,
  agents,
  showAgentFilters,
}: {
  tab: string;
  status?: string;
  priority?: string;
  category?: string;
  country?: string;
  assignedTo?: string;
  q?: string;
  categories: { value: string; label: string }[];
  agents: { id: number; label: string }[];
  showAgentFilters: boolean;
}) {
  return (
    <>
      <ul className="nav nav-pills mb-3 gap-1" role="tablist" aria-label="Ticket views">
        {TICKET_LIST_TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <Link
              className={`nav-link py-1 px-3${t.key === tab ? " active" : ""}`}
              href={`/tickets/?tab=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>

      <form method="get" action="/tickets/" className="card mb-3">
        <input type="hidden" name="tab" value={tab} />
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
                defaultValue={q ?? ""}
                placeholder="RDX-0042, name, title, asset…"
                maxLength={200}
              />
            </div>

            <div className="col-6 col-md-3 col-lg-2">
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
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TICKET_STATUS_LABELS[s as TicketStatus]}
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
                defaultValue={priority ?? ""}
              >
                <option value="">Any priority</option>
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TICKET_PRIORITY_LABELS[p as TicketPriority]}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-6 col-md-3 col-lg-2">
              <label className="form-label small mb-1" htmlFor="category">
                Category
              </label>
              <select
                className="form-select form-select-sm"
                id="category"
                name="category"
                defaultValue={category ?? ""}
              >
                <option value="">Any category</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {showAgentFilters && (
              <>
                <div className="col-6 col-md-3 col-lg-2">
                  <label className="form-label small mb-1" htmlFor="country">
                    Country
                  </label>
                  <select
                    className="form-select form-select-sm"
                    id="country"
                    name="country"
                    defaultValue={country ?? ""}
                  >
                    <option value="">All countries</option>
                    {COUNTRY_CODES.map((code) => (
                      <option key={code} value={code}>
                        {COUNTRY_NAMES[code]}
                      </option>
                    ))}
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div className="col-6 col-md-3 col-lg-2">
                  <label className="form-label small mb-1" htmlFor="assignedTo">
                    Assigned to
                  </label>
                  <select
                    className="form-select form-select-sm"
                    id="assignedTo"
                    name="assignedTo"
                    defaultValue={assignedTo ?? ""}
                  >
                    <option value="">Anyone</option>
                    <option value="none">Unassigned</option>
                    {agents.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="col-auto">
              <button type="submit" className="btn btn-sm btn-primary">
                <i className="bi bi-funnel me-1" aria-hidden="true" />
                Filter
              </button>
            </div>
            <div className="col-auto">
              <Link className="btn btn-sm btn-outline-secondary" href={`/tickets/?tab=${tab}`}>
                Clear
              </Link>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
