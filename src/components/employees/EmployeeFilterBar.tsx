"use client";

import Link from "next/link";
import { COUNTRY_CODES, COUNTRY_NAMES } from "@/lib/config/countries";

/** Employee list filters (spec §5.10). GET form — filters live in the URL. */
export function EmployeeFilterBar({
  country,
  department,
  staffGroup,
  q,
  view,
  departments,
  basePath,
}: {
  country?: string;
  department?: string;
  staffGroup?: string;
  q?: string;
  view: string;
  departments: string[];
  basePath: string;
}) {
  return (
    <form method="get" action={basePath} className="card mb-3">
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
              placeholder="Name, email, number, phone…"
              maxLength={200}
            />
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

          <div className="col-6 col-md-3 col-lg-3">
            <label className="form-label small mb-1" htmlFor="department">
              Department
            </label>
            <select
              className="form-select form-select-sm"
              id="department"
              name="department"
              defaultValue={department ?? ""}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="col-6 col-md-3 col-lg-2">
            <label className="form-label small mb-1" htmlFor="staffGroup">
              Group
            </label>
            <select
              className="form-select form-select-sm"
              id="staffGroup"
              name="staffGroup"
              defaultValue={staffGroup ?? ""}
            >
              <option value="">All groups</option>
              <option value="staff">Staff</option>
              <option value="management">Management</option>
              <option value="consultant">Consultant</option>
            </select>
          </div>

          <div className="col-auto">
            <button type="submit" className="btn btn-sm btn-primary">
              <i className="bi bi-funnel me-1" aria-hidden="true" />
              Filter
            </button>
          </div>
          <div className="col-auto">
            <Link className="btn btn-sm btn-outline-secondary" href={`${basePath}?view=${view}`}>
              Clear
            </Link>
          </div>
        </div>
      </div>
    </form>
  );
}
