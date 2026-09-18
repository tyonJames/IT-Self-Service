import type { Metadata } from "next";
import Link from "next/link";
import type { AssetCategory, AssetStatus } from "@prisma/client";
import { requireAgent } from "@/lib/permissions";
import { assetRepository, type AssetFilters, type AssetSort } from "@/repositories/asset.repository";
import { assetFilterSchema } from "@/lib/validation/assets";
import { parsePageRequest, paginate } from "@/lib/utils/pagination";
import { assetService } from "@/services/asset.service";
import { countryColour, countryName, COUNTRY_CODES } from "@/lib/config/countries";
import {
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANTS,
  SELECTABLE_ASSET_CATEGORIES,
  initialsOf,
} from "@/lib/domain/assets";
import { formatRelative } from "@/lib/utils/format";
import { CountryTile, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { AssetFilterBar } from "@/components/assets/AssetFilterBar";

export const metadata: Metadata = { title: "Asset register" };
export const dynamic = "force-dynamic";

/** `/assets/` — the register, with grid and table views (spec §5.7). */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAgent("/assets/");

  const raw = await searchParams;
  const query = assetFilterSchema.parse(raw);
  const page = parsePageRequest(raw as { page?: string }, query.view === "grid" ? 24 : 25);

  const filters: AssetFilters = {
    category: (query.category as AssetCategory | undefined) ?? null,
    status: (query.status as AssetStatus | undefined) ?? null,
    country: query.country ?? null,
    location: query.location ?? null,
    search: query.q ?? null,
    unassignedOnly: query.unassigned === "1",
    trackingOnly: query.tracking === "1",
  };

  const [{ rows, total }, tiles] = await Promise.all([
    assetRepository.list(filters, page, query.sort as AssetSort, query.dir),
    assetService.countryTiles(),
  ]);

  const result = paginate(rows, total, page);

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "page") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) params[key] = v;
  }

  const viewHref = (view: "grid" | "table"): string => {
    const next = new URLSearchParams(params);
    next.set("view", view);
    next.delete("page");
    return `/assets/?${next.toString()}`;
  };

  const tileMap = new Map(tiles.map((t) => [t.code, t.count]));

  return (
    <>
      <PageHeader
        title="Asset register"
        icon="bi-hdd-stack"
        subtitle="Every device Radx owns, and who has it"
        actions={
          <>
            <Link className="btn btn-outline-secondary btn-sm" href="/assets/import/">
              <i className="bi bi-upload me-1" aria-hidden="true" />
              Import CSV
            </Link>
            <Link className="btn btn-primary btn-sm" href="/assets/new/">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Add an asset
            </Link>
          </>
        }
      />

      {/* Country summary tiles (spec §5.7) */}
      <div className="row g-2 mb-3">
        {COUNTRY_CODES.map((code) => (
          <div className="col-6 col-lg-3" key={code}>
            <CountryTile
              code={code}
              count={tileMap.get(code) ?? 0}
              label={`${countryName(code)} — in service`}
              href={`/assets/?country=${code}&view=${query.view}`}
            />
          </div>
        ))}
      </div>

      <AssetFilterBar
        category={query.category}
        status={query.status}
        country={query.country}
        q={query.q}
        view={query.view}
        unassigned={query.unassigned === "1"}
        tracking={query.tracking === "1"}
        categories={SELECTABLE_ASSET_CATEGORIES.map((c) => ({
          value: c,
          label: ASSET_CATEGORY_LABELS[c],
        }))}
        statuses={ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] }))}
      />

      <div className="d-flex justify-content-between align-items-center mb-2">
        <p className="text-secondary small mb-0">
          {total.toLocaleString()} asset{total === 1 ? "" : "s"} match
        </p>
        <div className="btn-group btn-group-sm" role="group" aria-label="View mode">
          <Link
            className={`btn btn-outline-secondary${query.view === "table" ? " active" : ""}`}
            href={viewHref("table")}
            aria-pressed={query.view === "table"}
          >
            <i className="bi bi-list-ul me-1" aria-hidden="true" />
            Table
          </Link>
          <Link
            className={`btn btn-outline-secondary${query.view === "grid" ? " active" : ""}`}
            href={viewHref("grid")}
            aria-pressed={query.view === "grid"}
          >
            <i className="bi bi-grid-3x3-gap me-1" aria-hidden="true" />
            Grid
          </Link>
        </div>
      </div>

      {result.items.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <EmptyState
              icon="bi-hdd"
              title="No assets match these filters"
              hint="Adjust the filters, or add the first asset."
              action={
                <Link className="btn btn-outline-primary btn-sm" href="/assets/new/">
                  Add an asset
                </Link>
              }
            />
          </div>
        </div>
      ) : query.view === "grid" ? (
        <div className="row g-3">
          {result.items.map((asset) => (
            <div className="col-sm-6 col-lg-4 col-xxl-3" key={asset.id}>
              <Link href={`/assets/${asset.id}/`} className="text-decoration-none text-body">
                <div
                  className="asset-card"
                  style={{ ["--country-accent" as string]: countryColour(asset.site) }}
                >
                  <div className="d-flex align-items-start justify-content-between">
                    <i
                      className={`bi ${ASSET_CATEGORY_ICONS[asset.category]} asset-card-icon`}
                      aria-hidden="true"
                    />
                    <span className={`badge bg-${ASSET_STATUS_VARIANTS[asset.status]}`}>
                      {ASSET_STATUS_LABELS[asset.status]}
                    </span>
                  </div>

                  <div>
                    <div className="fw-semibold">{asset.assetTag ?? `Asset #${asset.id}`}</div>
                    <div className="small text-secondary">
                      {`${asset.brand} ${asset.model}`.trim() || ASSET_CATEGORY_LABELS[asset.category]}
                    </div>
                  </div>

                  <div className="d-flex align-items-center gap-2 mt-auto">
                    {asset.assignedToName ? (
                      <>
                        <span className="avatar-chip" aria-hidden="true">
                          {initialsOf(asset.assignedToName)}
                        </span>
                        <span className="small text-truncate">{asset.assignedToName}</span>
                      </>
                    ) : (
                      <span className="small text-warning">
                        <i className="bi bi-question-circle me-1" aria-hidden="true" />
                        Unassigned
                      </span>
                    )}
                  </div>

                  <div className="small text-secondary d-flex justify-content-between">
                    <span>{countryName(asset.site)}</span>
                    {asset.trackingEnabled && asset.lastSeenAt && (
                      <span title={asset.lastSeenLocation}>
                        <i className="bi bi-geo-alt me-1" aria-hidden="true" />
                        {formatRelative(asset.lastSeenAt)}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <caption className="visually-hidden">
                Asset register, page {result.page} of {result.totalPages}
              </caption>
              <thead className="table-light">
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="d-none d-md-table-cell">
                    Make / model
                  </th>
                  <th scope="col">Holder</th>
                  <th scope="col" className="d-none d-lg-table-cell">
                    Country / site
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="d-none d-xl-table-cell">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((asset) => (
                  <tr key={asset.id}>
                    <th scope="row" className="fw-normal">
                      <span
                        className="country-accent ps-2 d-inline-block"
                        style={{ ["--country-accent" as string]: countryColour(asset.site) }}
                      >
                        <Link className="text-decoration-none fw-semibold" href={`/assets/${asset.id}/`}>
                          {asset.assetTag ?? `#${asset.id}`}
                        </Link>
                      </span>
                    </th>
                    <td className="small">
                      <i className={`bi ${ASSET_CATEGORY_ICONS[asset.category]} me-1 text-secondary`} aria-hidden="true" />
                      {ASSET_CATEGORY_LABELS[asset.category]}
                    </td>
                    <td className="small d-none d-md-table-cell">
                      {`${asset.brand} ${asset.model}`.trim() || "—"}
                      {asset.serialNumber && (
                        <div className="text-secondary">
                          <code>{asset.serialNumber}</code>
                        </div>
                      )}
                    </td>
                    <td className="small">
                      {asset.assignedEmployee ? (
                        <Link href={`/employees/${asset.assignedEmployee.id}/`}>
                          {asset.assignedEmployee.fullName}
                        </Link>
                      ) : asset.assignedSite ? (
                        <span>
                          <i className="bi bi-building me-1 text-secondary" aria-hidden="true" />
                          {asset.assignedSite.name}
                        </span>
                      ) : (
                        <span className="text-warning">Unassigned</span>
                      )}
                    </td>
                    <td className="small d-none d-lg-table-cell">
                      {countryName(asset.site)}
                      {asset.location && <div className="text-secondary">{asset.location}</div>}
                    </td>
                    <td>
                      <span className={`badge bg-${ASSET_STATUS_VARIANTS[asset.status]}`}>
                        {ASSET_STATUS_LABELS[asset.status]}
                      </span>
                    </td>
                    <td className="small d-none d-xl-table-cell text-secondary">
                      {asset.trackingEnabled && asset.lastSeenAt ? (
                        <span title={asset.lastSeenLocation}>{formatRelative(asset.lastSeenAt)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination result={result} baseUrl="/assets/" params={params} itemLabel="assets" />
    </>
  );
}
