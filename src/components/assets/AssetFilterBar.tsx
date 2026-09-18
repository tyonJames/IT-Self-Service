"use client";

import Link from "next/link";
import { COUNTRY_CODES, COUNTRY_NAMES } from "@/lib/config/countries";

/** Asset register filters (spec §5.7). GET form — filters live in the URL. */
export function AssetFilterBar({
  category,
  status,
  country,
  q,
  view,
  unassigned,
  tracking,
  categories,
  statuses,
}: {
  category?: string;
  status?: string;
  country?: string;
  q?: string;
  view: string;
  unassigned: boolean;
  tracking: boolean;
  categories: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
}) {
  return (
    <form method="get" action="/assets/" className="card mb-3">
      <input type="hidden" name="view" value={view} />
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
              placeholder="Tag, serial, make, holder, MAC…"
              maxLength={200}
            />
          </div>

          <div className="col-6 col-md-3 col-lg-2">
            <label className="form-label small mb-1" htmlFor="category">
              Type
            </label>
            <select
              className="form-select form-select-sm"
              id="category"
              name="category"
              defaultValue={category ?? ""}
            >
              <option value="">Any type</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
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
              defaultValue={status ?? ""}
            >
              <option value="">Any status</option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
              defaultValue={country ?? ""}
            >
              <option value="">All countries</option>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {COUNTRY_NAMES[code]}
                </option>
              ))}
            </select>
          </div>

          <div className="col-auto">
            <div className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                id="unassigned"
                name="unassigned"
                value="1"
                defaultChecked={unassigned}
              />
              <label className="form-check-label small" htmlFor="unassigned">
                Unassigned only
              </label>
            </div>
            <div className="form-check">
              <input
                className="form-check-input"
                type="checkbox"
                id="tracking"
                name="tracking"
                value="1"
                defaultChecked={tracking}
              />
              <label className="form-check-label small" htmlFor="tracking">
                Tracked devices only
              </label>
            </div>
          </div>

          <div className="col-auto">
            <button type="submit" className="btn btn-sm btn-primary">
              <i className="bi bi-funnel me-1" aria-hidden="true" />
              Filter
            </button>
          </div>
          <div className="col-auto">
            <Link className="btn btn-sm btn-outline-secondary" href={`/assets/?view=${view}`}>
              Clear
            </Link>
          </div>
        </div>
      </div>
    </form>
  );
}
