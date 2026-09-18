"use client";

import Link from "next/link";

/**
 * Top bar: sidebar toggle on small screens, page title, user identity,
 * role badge, and the logout form (spec §1).
 *
 * Logout is a POST form, not a link: a GET logout can be triggered by an
 * <img> tag on any page on the internet.
 */
export function Navbar({
  name,
  role,
  csrfToken,
  onToggleSidebar,
}: {
  name: string;
  role: string;
  csrfToken: string;
  onToggleSidebar: () => void;
}) {
  const roleVariant = role === "admin" ? "danger" : role === "agent" ? "success" : "secondary";
  const roleLabel = role === "admin" ? "Admin" : role === "agent" ? "IT Agent" : "Staff";

  return (
    <header className="app-navbar">
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm d-lg-none"
        onClick={onToggleSidebar}
        aria-label="Open navigation"
        aria-controls="app-sidebar"
      >
        <i className="bi bi-list" aria-hidden="true" />
      </button>

      <Link href="/tickets/reports/" className="fw-semibold text-decoration-none text-radx d-lg-none">
        Radx IT
      </Link>

      <div className="ms-auto d-flex align-items-center gap-2">
        <Link
          href="/help/"
          className="btn btn-sm btn-outline-secondary d-none d-md-inline-flex align-items-center gap-1"
          title="Open the self-service portal that staff use"
        >
          <i className="bi bi-life-preserver" aria-hidden="true" />
          <span>Self-service portal</span>
        </Link>

        <div className="dropdown">
          <button
            className="btn btn-sm btn-light dropdown-toggle d-flex align-items-center gap-2"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <span className="avatar-chip" aria-hidden="true">
              {name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase() || "?"}
            </span>
            <span className="d-none d-sm-inline">{name}</span>
            <span className={`badge bg-${roleVariant}`}>{roleLabel}</span>
          </button>
          <ul className="dropdown-menu dropdown-menu-end">
            <li>
              <Link className="dropdown-item" href="/accounts/profile/">
                <i className="bi bi-person-gear me-2" aria-hidden="true" />
                My profile
              </Link>
            </li>
            {role === "admin" && (
              <li>
                <Link className="dropdown-item" href="/accounts/users/">
                  <i className="bi bi-people me-2" aria-hidden="true" />
                  User accounts
                </Link>
              </li>
            )}
            <li>
              <hr className="dropdown-divider" />
            </li>
            <li>
              <form action="/accounts/logout/" method="post" className="px-1">
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <button type="submit" className="dropdown-item text-danger">
                  <i className="bi bi-box-arrow-right me-2" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}
