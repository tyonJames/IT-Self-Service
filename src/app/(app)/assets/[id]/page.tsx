import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/permissions";
import { assetRepository } from "@/repositories/asset.repository";
import { ticketRepository } from "@/repositories/ticket.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { countryColour, countryName } from "@/lib/config/countries";
import {
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  ASSET_SPEC_FIELD_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANTS,
  CATEGORY_FIELDS,
  TRACKABLE_CATEGORIES,
  repairRecommendation,
} from "@/lib/domain/assets";
import { tagMismatch, expectedTagPrefix } from "@/lib/domain/asset-tag";
import { mapUrl, shortLocation } from "@/services/device.service";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/utils/format";
import {
  ticketReference,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANTS,
} from "@/lib/domain/tickets";
import { Alert, DefinitionRow, EmptyState, PageHeader, Section } from "@/components/ui";
import {
  DocumentUploadPanel,
  ManualLocationPanel,
  RotateKeyPanel,
} from "@/components/assets/AssetPanels";
import { deleteAsset, deleteAssetDocument, disableTracking } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Asset ${id}` };
}

/** `/assets/{id}/` — the 360-degree asset view (spec §5.8). */
export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAgent();

  const { id } = await params;
  const assetId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(assetId) || assetId <= 0) notFound();

  const asset = await assetRepository.findById(assetId);
  if (!asset) notFound();

  const [faultTickets, categories, csrfToken] = await Promise.all([
    ticketRepository.listForAsset(assetId),
    lookupRepository.ticketCategoryLabels(),
    currentCsrfToken(),
  ]);

  const advice = repairRecommendation(faultTickets.length);
  const mismatch = tagMismatch(asset);
  const accent = countryColour(asset.site);
  const specFields = CATEGORY_FIELDS[asset.category] ?? [];
  const trackable = TRACKABLE_CATEGORIES.has(asset.category);
  const title = asset.assetTag ?? `Asset #${asset.id}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/assets/">Assets</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            {title}
          </li>
        </ol>
      </nav>

      <div
        className="country-accent bg-white rounded p-3 mb-3"
        style={{ ["--country-accent" as string]: accent }}
      >
        <PageHeader
          title={title}
          icon={ASSET_CATEGORY_ICONS[asset.category]}
          subtitle={`${`${asset.brand} ${asset.model}`.trim() || ASSET_CATEGORY_LABELS[asset.category]} · ${countryName(asset.site)}${asset.location ? ` — ${asset.location}` : ""}`}
          actions={
            <>
              <Link className="btn btn-outline-secondary btn-sm" href={`/assets/${asset.id}/edit/`}>
                <i className="bi bi-pencil me-1" aria-hidden="true" />
                Edit
              </Link>
              <form action={deleteAsset}>
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <input type="hidden" name="assetId" value={asset.id} />
                <button type="submit" className="btn btn-outline-danger btn-sm">
                  <i className="bi bi-trash3 me-1" aria-hidden="true" />
                  Delete
                </button>
              </form>
            </>
          }
        />

        <div className="d-flex flex-wrap gap-2">
          <span className={`badge bg-${ASSET_STATUS_VARIANTS[asset.status]}`}>
            {ASSET_STATUS_LABELS[asset.status]}
          </span>
          <span className="badge bg-light text-dark border">
            {ASSET_CATEGORY_LABELS[asset.category]}
          </span>
          <span className={`badge bg-${advice.variant}`} title={advice.detail}>
            <i className="bi bi-wrench-adjustable me-1" aria-hidden="true" />
            {advice.label}
          </span>
          {asset.trackingEnabled && (
            <span className="badge bg-info text-dark">
              <i className="bi bi-broadcast me-1" aria-hidden="true" />
              Tracking on
            </span>
          )}
        </div>
      </div>

      {mismatch && (
        <Alert variant="warning" title="Asset tag does not match this record" icon="bi-upc-scan">
          {mismatch}
          {expectedTagPrefix(asset) && (
            <>
              {" "}
              A tag for this country and type would start <code>{expectedTagPrefix(asset)}</code>.
            </>
          )}{" "}
          Tags are assigned by the business, so this needs a human decision — correct the record, or
          correct the sticker.
        </Alert>
      )}

      <div className="row g-3">
        <div className="col-lg-7">
          <Section title="Specification" icon="bi-info-circle">
            <dl className="mb-0">
              <DefinitionRow label="Asset tag">
                {asset.assetTag ?? <span className="text-secondary">None</span>}
              </DefinitionRow>
              <DefinitionRow label="Type">{ASSET_CATEGORY_LABELS[asset.category]}</DefinitionRow>
              <DefinitionRow label="Make">{asset.brand || "—"}</DefinitionRow>
              <DefinitionRow label="Model">{asset.model || "—"}</DefinitionRow>
              <DefinitionRow label="Serial number">
                {asset.serialNumber ? <code>{asset.serialNumber}</code> : "—"}
              </DefinitionRow>
              <DefinitionRow label="Acquired" hidden={!asset.acquisitionDate}>
                {asset.acquisitionDate?.toISOString().slice(0, 10)}
              </DefinitionRow>

              {specFields.map((field) => {
                const value = (asset as unknown as Record<string, string>)[field] ?? "";
                return (
                  <DefinitionRow
                    key={field}
                    label={ASSET_SPEC_FIELD_LABELS[field] ?? field}
                    hidden={!value}
                  >
                    <code>{value}</code>
                  </DefinitionRow>
                );
              })}

              <DefinitionRow label="Notes" hidden={!asset.notes}>
                <span style={{ whiteSpace: "pre-wrap" }}>{asset.notes}</span>
              </DefinitionRow>
            </dl>
          </Section>

          <Section
            title={`Fault history (${faultTickets.length})`}
            icon="bi-clipboard2-pulse"
            actions={
              <span className={`badge bg-${advice.variant}`} title={advice.detail}>
                {advice.label}
              </span>
            }
          >
            <p className="small text-secondary">{advice.detail}</p>

            {faultTickets.length === 0 ? (
              <EmptyState icon="bi-emoji-smile" title="No faults recorded against this device" />
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <caption className="visually-hidden">Tickets raised about this asset</caption>
                  <thead className="table-light">
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Problem</th>
                      <th scope="col">Category</th>
                      <th scope="col">Status</th>
                      <th scope="col">Raised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faultTickets.map((ticket) => (
                      <tr key={ticket.id}>
                        <th scope="row" className="fw-normal">
                          <Link href={`/tickets/${ticket.id}/`}>{ticketReference(ticket.id)}</Link>
                        </th>
                        <td className="small">{ticket.title}</td>
                        <td className="small">{categories.get(ticket.category) ?? ticket.category}</td>
                        <td>
                          <span className={`badge bg-${TICKET_STATUS_VARIANTS[ticket.status]}`}>
                            {TICKET_STATUS_LABELS[ticket.status]}
                          </span>
                        </td>
                        <td className="small text-secondary">{formatDateTime(ticket.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`Documents (${asset.documents.length})`} icon="bi-file-earmark-text">
            {asset.documents.length === 0 ? (
              <p className="text-secondary small">
                No allocation form or signed policy on file for this device yet.
              </p>
            ) : (
              <ul className="list-group list-group-flush mb-3">
                {asset.documents.map((doc) => (
                  <li
                    key={doc.id.toString()}
                    className="list-group-item d-flex align-items-center justify-content-between px-0"
                  >
                    <span className="text-truncate">
                      <i className="bi bi-file-earmark-text me-2 text-secondary" aria-hidden="true" />
                      <a href={`/assets/doc/${doc.id}/download/`}>{doc.filename}</a>
                      <span className="badge bg-light text-dark border ms-2 text-capitalize">
                        {doc.documentType}
                      </span>
                      <span className="text-secondary small ms-2">{formatBytes(doc.sizeBytes)}</span>
                      {doc.notes && <div className="small text-secondary">{doc.notes}</div>}
                    </span>
                    <form action={deleteAssetDocument}>
                      <input type="hidden" name="csrf_token" value={csrfToken} />
                      <input type="hidden" name="documentId" value={doc.id.toString()} />
                      <button
                        type="submit"
                        className="btn btn-sm btn-link text-danger"
                        aria-label={`Delete ${doc.filename}`}
                      >
                        <i className="bi bi-trash3" aria-hidden="true" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <DocumentUploadPanel assetId={asset.id} csrfToken={csrfToken} />
          </Section>
        </div>

        <div className="col-lg-5">
          <Section title="Assigned to" icon="bi-person-badge">
            {asset.assignedEmployee ? (
              <dl className="mb-0">
                <DefinitionRow label="Employee">
                  <Link href={`/employees/${asset.assignedEmployee.id}/`}>
                    {asset.assignedEmployee.fullName}
                  </Link>
                  {!asset.assignedEmployee.isActive && (
                    <span className="badge bg-warning text-dark ms-2">Suspended</span>
                  )}
                </DefinitionRow>
                <DefinitionRow label="Email">
                  <a href={`mailto:${asset.assignedEmployee.email}`}>{asset.assignedEmployee.email}</a>
                </DefinitionRow>
                <DefinitionRow label="Job title" hidden={!asset.assignedEmployee.jobTitle}>
                  {asset.assignedEmployee.jobTitle}
                </DefinitionRow>
                <DefinitionRow label="Department" hidden={!asset.assignedEmployee.department}>
                  {asset.assignedEmployee.department}
                </DefinitionRow>
              </dl>
            ) : asset.assignedSite ? (
              <dl className="mb-0">
                <DefinitionRow label="Site">
                  {asset.assignedSite.name}
                  {asset.assignedSite.code && (
                    <span className="text-secondary"> ({asset.assignedSite.code})</span>
                  )}
                </DefinitionRow>
                <DefinitionRow label="Country">
                  {countryName(asset.assignedSite.siteCountry)}
                </DefinitionRow>
                <DefinitionRow label="Address" hidden={!asset.assignedSite.address}>
                  {asset.assignedSite.address}
                </DefinitionRow>
              </dl>
            ) : (
              <EmptyState
                icon="bi-question-circle"
                title="Not assigned to anyone"
                hint="Assign it to a person or a site so it stops showing up in the data-health report."
                action={
                  <Link className="btn btn-sm btn-outline-primary" href={`/assets/${asset.id}/edit/`}>
                    Assign it
                  </Link>
                }
              />
            )}
          </Section>

          {trackable && (
            <Section title="Device tracking" icon="bi-broadcast-pin">
              <dl className="mb-3">
                <DefinitionRow label="Tracking">
                  {asset.trackingEnabled ? (
                    <span className="text-success">Enabled</span>
                  ) : (
                    <span className="text-secondary">Not enrolled</span>
                  )}
                </DefinitionRow>
                <DefinitionRow label="Last seen" hidden={!asset.lastSeenAt}>
                  {formatRelative(asset.lastSeenAt)}
                  <div className="small text-secondary">{formatDateTime(asset.lastSeenAt)}</div>
                </DefinitionRow>
                <DefinitionRow label="Location" hidden={!asset.lastSeenLocation}>
                  {asset.lastSeenLocation}
                </DefinitionRow>
                <DefinitionRow label="Key issued" hidden={!asset.deviceKeySetAt}>
                  {formatDateTime(asset.deviceKeySetAt)}
                </DefinitionRow>
              </dl>

              <RotateKeyPanel
                assetId={asset.id}
                hasKey={Boolean(asset.deviceKeyHash)}
                csrfToken={csrfToken}
              />

              {asset.trackingEnabled && (
                <form action={disableTracking} className="mt-2">
                  <input type="hidden" name="csrf_token" value={csrfToken} />
                  <input type="hidden" name="assetId" value={asset.id} />
                  <button type="submit" className="btn btn-sm btn-link text-danger px-0">
                    Turn tracking off and revoke the key
                  </button>
                </form>
              )}

              {asset.checkins.length > 0 && (
                <>
                  <hr />
                  <h3 className="h6">Check-in history</h3>
                  <ul className="timeline small">
                    {asset.checkins.slice(0, 15).map((checkin) => {
                      const link = mapUrl(checkin);
                      return (
                        <li key={checkin.id.toString()}>
                          <div className="fw-medium">{shortLocation(checkin)}</div>
                          <div className="text-secondary">
                            {formatDateTime(checkin.reportedAt)}
                            {checkin.source === "manual" && " · recorded by hand"}
                          </div>
                          {(checkin.hostname || checkin.loggedInUser) && (
                            <div className="text-secondary">
                              {checkin.hostname && <code>{checkin.hostname}</code>}
                              {checkin.loggedInUser && ` · ${checkin.loggedInUser}`}
                            </div>
                          )}
                          {link && (
                            <a href={link} rel="noopener noreferrer" target="_blank">
                              <i className="bi bi-map me-1" aria-hidden="true" />
                              View on OpenStreetMap
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              <hr />
              <h3 className="h6">Record a location by hand</h3>
              <ManualLocationPanel assetId={asset.id} csrfToken={csrfToken} />
            </Section>
          )}

          <Section title="Record" icon="bi-clock-history">
            <dl className="mb-0">
              <DefinitionRow label="Added">{formatDateTime(asset.createdAt)}</DefinitionRow>
              <DefinitionRow label="Last updated">{formatDateTime(asset.updatedAt)}</DefinitionRow>
              <DefinitionRow label="Country">{countryName(asset.site)}</DefinitionRow>
              <DefinitionRow label="Site" hidden={!asset.location}>
                {asset.location}
              </DefinitionRow>
              <DefinitionRow label="Department" hidden={!asset.department}>
                {asset.department}
              </DefinitionRow>
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}
