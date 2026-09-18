import Link from "next/link";
import { countryColour, countryName } from "@/lib/config/countries";
import { pageWindow, type Paginated } from "@/lib/utils/pagination";

/**
 * Small, reusable presentation pieces. No data access, no business logic —
 * these are Server Components by default and take everything as props.
 */

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
      <div>
        <h1 className="h4 mb-1 d-flex align-items-center gap-2">
          {icon && <i className={`bi ${icon} text-radx`} aria-hidden="true" />}
          {title}
        </h1>
        {subtitle && <p className="text-secondary mb-0 small">{subtitle}</p>}
      </div>
      {actions && <div className="d-flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon = "bi-inbox",
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <i className={`bi ${icon}`} aria-hidden="true" />
      <p className="mb-1 fw-medium">{title}</p>
      {hint && <p className="small mb-3">{hint}</p>}
      {action}
    </div>
  );
}

export function Alert({
  variant,
  title,
  children,
  icon,
}: {
  variant: "success" | "danger" | "warning" | "info";
  title?: string;
  children: React.ReactNode;
  icon?: string;
}) {
  const defaultIcon =
    variant === "success"
      ? "bi-check-circle"
      : variant === "danger"
        ? "bi-exclamation-octagon"
        : variant === "warning"
          ? "bi-exclamation-triangle"
          : "bi-info-circle";

  return (
    <div className={`alert alert-${variant} d-flex gap-2`} role={variant === "danger" ? "alert" : "status"}>
      <i className={`bi ${icon ?? defaultIcon} flex-shrink-0`} aria-hidden="true" />
      <div>
        {title && <div className="fw-semibold">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export function Badge({
  variant,
  children,
  icon,
  title,
}: {
  variant: string;
  children: React.ReactNode;
  icon?: string;
  title?: string;
}) {
  return (
    <span className={`badge bg-${variant}`} title={title}>
      {icon && <i className={`bi ${icon} me-1`} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Country badge in that country's accent colour (spec §1). */
export function CountryBadge({ code, showName = true }: { code: string; showName?: boolean }) {
  const colour = countryColour(code);
  const name = countryName(code);
  return (
    <span className="badge country-badge" style={{ ["--country-accent" as string]: colour }} title={name}>
      {showName ? name : code}
    </span>
  );
}

export function CountryDot({ code }: { code: string }) {
  return (
    <>
      <span
        className="country-dot"
        style={{ ["--country-accent" as string]: countryColour(code) }}
        aria-hidden="true"
      />
      <span className="visually-hidden">{countryName(code)}</span>
    </>
  );
}

/** Country summary tile used on the asset and employee lists (spec §5.7, §5.10). */
export function CountryTile({
  code,
  count,
  label,
  href,
}: {
  code: string;
  count: number;
  label?: string;
  href?: string;
}) {
  const inner = (
    <div className="country-tile" style={{ ["--country-accent" as string]: countryColour(code) }}>
      <div className="country-tile-count">{count.toLocaleString()}</div>
      <div className="small text-secondary">{label ?? countryName(code)}</div>
    </div>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="text-decoration-none d-block h-100">
      {inner}
    </Link>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  variant = "secondary",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: string;
  variant?: string;
}) {
  return (
    <div className="stat-tile">
      <div className="d-flex justify-content-between align-items-start">
        <div className="stat-tile-label">{label}</div>
        {icon && <i className={`bi ${icon} text-${variant}`} aria-hidden="true" />}
      </div>
      <div className={`stat-tile-value text-${variant}`}>{value}</div>
      {hint && <div className="stat-tile-hint">{hint}</div>}
    </div>
  );
}

export function AvatarChip({ initials, title }: { initials: string; title?: string }) {
  return (
    <span className="avatar-chip" title={title} aria-hidden="true">
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function pageHref(baseUrl: string, params: Record<string, string>, page: number): string {
  const search = new URLSearchParams(params);
  search.set("page", String(page));
  const query = search.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

export function Pagination<T>({
  result,
  baseUrl,
  params,
  itemLabel = "records",
}: {
  result: Paginated<T>;
  baseUrl: string;
  params: Record<string, string>;
  itemLabel?: string;
}) {
  if (result.total === 0) return null;

  const pages = pageWindow(result.page, result.totalPages);

  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
      <p className="text-secondary small mb-0">
        Showing <strong>{result.from.toLocaleString()}</strong>–<strong>{result.to.toLocaleString()}</strong> of{" "}
        <strong>{result.total.toLocaleString()}</strong> {itemLabel}
      </p>

      {result.totalPages > 1 && (
        <nav aria-label="Pagination">
          <ul className="pagination pagination-sm mb-0">
            <li className={`page-item${result.hasPrevious ? "" : " disabled"}`}>
              <Link
                className="page-link"
                href={pageHref(baseUrl, params, result.page - 1)}
                aria-label="Previous page"
                aria-disabled={!result.hasPrevious}
                tabIndex={result.hasPrevious ? undefined : -1}
              >
                <i className="bi bi-chevron-left" aria-hidden="true" />
              </Link>
            </li>

            {pages.map((p, index) =>
              p === "…" ? (
                // eslint-disable-next-line react/no-array-index-key
                <li key={`gap-${index}`} className="page-item disabled">
                  <span className="page-link">…</span>
                </li>
              ) : (
                <li key={p} className={`page-item${p === result.page ? " active" : ""}`}>
                  <Link
                    className="page-link"
                    href={pageHref(baseUrl, params, p)}
                    aria-current={p === result.page ? "page" : undefined}
                  >
                    {p}
                  </Link>
                </li>
              ),
            )}

            <li className={`page-item${result.hasNext ? "" : " disabled"}`}>
              <Link
                className="page-link"
                href={pageHref(baseUrl, params, result.page + 1)}
                aria-label="Next page"
                aria-disabled={!result.hasNext}
                tabIndex={result.hasNext ? undefined : -1}
              >
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail layout helpers
// ---------------------------------------------------------------------------

export function DefinitionRow({
  label,
  children,
  hidden = false,
}: {
  label: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="row g-2 py-1 border-bottom border-light-subtle">
      <dt className="col-sm-5 col-lg-4 text-secondary fw-normal small">{label}</dt>
      <dd className="col-sm-7 col-lg-8 mb-0">{children}</dd>
    </div>
  );
}

export function Section({
  title,
  icon,
  actions,
  children,
  bodyClassName = "",
}: {
  title: string;
  icon?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="card mb-3">
      <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
        <span>
          {icon && <i className={`bi ${icon} me-2 text-radx`} aria-hidden="true" />}
          {title}
        </span>
        {actions}
      </div>
      <div className={`card-body ${bodyClassName}`}>{children}</div>
    </section>
  );
}
