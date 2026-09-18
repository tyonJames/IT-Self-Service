"use client";

import { useState } from "react";
import { COUNTRY_CODES, COUNTRY_NAMES } from "@/lib/config/countries";

/**
 * Period and country filter bar for the report pages (spec §5.4).
 *
 * A plain GET form: the current filters live in the URL, which makes every
 * view bookmarkable, shareable and back-button friendly, and means the export
 * links can carry the same query string so exports respect the filters
 * (instruction §20).
 */
export function ReportFilters({
  basePath,
  period,
  from,
  to,
  country,
  extra,
}: {
  basePath: string;
  period: string;
  from: string;
  to: string;
  country: string;
  extra?: React.ReactNode;
}) {
  const [selected, setSelected] = useState(period);

  return (
    <form method="get" action={basePath} className="card mb-3">
      <div className="card-body py-2">
        <div className="row g-2 align-items-end">
          <div className="col-6 col-md-3">
            <label className="form-label small mb-1" htmlFor="period">
              Period
            </label>
            <select
              className="form-select form-select-sm"
              id="period"
              name="period"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
              <option value="custom">Custom range…</option>
            </select>
          </div>

          {selected === "custom" && (
            <>
              <div className="col-6 col-md-2">
                <label className="form-label small mb-1" htmlFor="from">
                  From
                </label>
                <input
                  className="form-control form-control-sm"
                  type="date"
                  id="from"
                  name="from"
                  defaultValue={from}
                />
              </div>
              <div className="col-6 col-md-2">
                <label className="form-label small mb-1" htmlFor="to">
                  To
                </label>
                <input
                  className="form-control form-control-sm"
                  type="date"
                  id="to"
                  name="to"
                  defaultValue={to}
                />
              </div>
            </>
          )}

          <div className="col-6 col-md-3">
            <label className="form-label small mb-1" htmlFor="country">
              Country
            </label>
            <select
              className="form-select form-select-sm"
              id="country"
              name="country"
              defaultValue={country}
            >
              <option value="">All countries</option>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {COUNTRY_NAMES[code]}
                </option>
              ))}
            </select>
          </div>

          {extra}

          <div className="col-auto">
            <button type="submit" className="btn btn-sm btn-primary">
              <i className="bi bi-funnel me-1" aria-hidden="true" />
              Apply
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
