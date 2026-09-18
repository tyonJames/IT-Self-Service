import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/permissions";
import { equipmentRepository } from "@/repositories/equipment.repository";
import { assetRepository } from "@/repositories/asset.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { countryColour, countryName } from "@/lib/config/countries";
import {
  allowedTransitions,
  EQUIPMENT_STATUS_ICONS,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUS_VARIANTS,
} from "@/lib/domain/equipment-status";
import { ASSET_CATEGORY_LABELS } from "@/lib/domain/assets";
import { formatDateTime, formatRelative } from "@/lib/utils/format";
import { DefinitionRow, EmptyState, PageHeader, Section } from "@/components/ui";
import { DecisionPanel } from "@/components/equipment/DecisionPanel";
import { deleteEquipmentRequest } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Equipment request #${id}` };
}

/** `/equipment/{id}/` — request detail with the decision panel (spec §5.13). */
export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAgent();

  const { id } = await params;
  const requestId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) notFound();

  const request = await equipmentRepository.findById(requestId);
  if (!request) notFound();

  const [itemLabels, spareAssets, csrfToken] = await Promise.all([
    lookupRepository.equipmentItemTypeLabels(),
    assetRepository.list(
      { status: "spare", inServiceOnly: false },
      { page: 1, pageSize: 100, skip: 0, take: 100 },
    ),
    currentCsrfToken(),
  ]);

  const accent = countryColour(request.country);
  const allowed = allowedTransitions(request.status);

  // Devices that could plausibly be handed over: anything spare, plus whatever
  // is already linked to this request so a re-save does not drop it.
  const candidateAssets = [
    ...spareAssets.rows.map((a) => ({
      id: a.id,
      label: `${a.assetTag ?? `#${a.id}`} — ${ASSET_CATEGORY_LABELS[a.category]} ${`${a.brand} ${a.model}`.trim()}`.trim(),
    })),
    ...request.issuedAssets
      .filter((a) => !spareAssets.rows.some((s) => s.id === a.id))
      .map((a) => ({
        id: a.id,
        label: `${a.assetTag ?? `#${a.id}`} — ${ASSET_CATEGORY_LABELS[a.category]} ${`${a.brand} ${a.model}`.trim()} (already linked)`.trim(),
      })),
  ];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/equipment/">Equipment requests</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            #{request.id}
          </li>
        </ol>
      </nav>

      <div
        className="country-accent bg-white rounded p-3 mb-3"
        style={{ ["--country-accent" as string]: accent }}
      >
        <PageHeader
          title={`Request #${request.id} — ${request.requesterName}`}
          subtitle={`${countryName(request.country)}${request.siteName ? ` · ${request.siteName}` : ""} · raised ${formatRelative(request.createdAt)}`}
          actions={
            <form action={deleteEquipmentRequest}>
              <input type="hidden" name="csrf_token" value={csrfToken} />
              <input type="hidden" name="requestId" value={request.id} />
              <button type="submit" className="btn btn-outline-danger btn-sm">
                <i className="bi bi-trash3 me-1" aria-hidden="true" />
                Delete
              </button>
            </form>
          }
        />

        <div className="d-flex flex-wrap gap-2">
          <span className={`badge bg-${EQUIPMENT_STATUS_VARIANTS[request.status]}`}>
            <i className={`bi ${EQUIPMENT_STATUS_ICONS[request.status]} me-1`} aria-hidden="true" />
            {EQUIPMENT_STATUS_LABELS[request.status]}
          </span>
          {request.priority === "urgent" && <span className="badge bg-danger">Urgent</span>}
          {request.department && (
            <span className="badge bg-light text-dark border">{request.department}</span>
          )}
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-7">
          <Section title="What was asked for" icon="bi-list-check">
            {request.items.length === 0 && !request.otherEquipment ? (
              <p className="text-secondary mb-0">No items were listed on this request.</p>
            ) : (
              <ul className="list-group list-group-flush">
                {request.items.map((item) => (
                  <li key={item.id.toString()} className="list-group-item px-0 d-flex justify-content-between">
                    <span>{itemLabels.get(item.item) ?? item.item}</span>
                    <span className="badge bg-light text-dark border">× {item.quantity}</span>
                  </li>
                ))}
                {request.otherEquipment && (
                  <li className="list-group-item px-0">
                    <span className="text-secondary small d-block">Something else</span>
                    {request.otherEquipment}
                  </li>
                )}
              </ul>
            )}
          </Section>

          <Section title="Why" icon="bi-chat-square-quote">
            <dl className="mb-0">
              <DefinitionRow label="Reason">{request.reason || "—"}</DefinitionRow>
              <DefinitionRow label="Justification" hidden={!request.justification}>
                <span style={{ whiteSpace: "pre-wrap" }}>{request.justification}</span>
              </DefinitionRow>
            </dl>
          </Section>

          {request.issuedAssets.length > 0 && (
            <Section title={`Devices issued (${request.issuedAssets.length})`} icon="bi-hdd-stack">
              <ul className="list-group list-group-flush">
                {request.issuedAssets.map((asset) => (
                  <li key={asset.id} className="list-group-item px-0 d-flex justify-content-between">
                    <span>
                      <Link href={`/assets/${asset.id}/`}>{asset.assetTag ?? `Asset #${asset.id}`}</Link>
                      <span className="text-secondary small ms-2">
                        {ASSET_CATEGORY_LABELS[asset.category]} · {`${asset.brand} ${asset.model}`.trim()}
                      </span>
                    </span>
                    <span className="badge bg-light text-dark border text-capitalize">
                      {asset.status.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="History" icon="bi-clock-history">
            {request.statusHistory.length === 0 ? (
              <EmptyState icon="bi-hourglass" title="No decisions recorded yet" />
            ) : (
              <ul className="timeline small mb-0">
                <li>
                  <div className="fw-medium">Submitted</div>
                  <div className="text-secondary">{formatDateTime(request.createdAt)}</div>
                  <div className="text-secondary">by {request.requesterName}</div>
                </li>
                {request.statusHistory.map((event) => (
                  <li key={event.id.toString()}>
                    <div className="fw-medium">
                      {EQUIPMENT_STATUS_LABELS[event.fromStatus]} →{" "}
                      <span className={`text-${EQUIPMENT_STATUS_VARIANTS[event.toStatus]}`}>
                        {EQUIPMENT_STATUS_LABELS[event.toStatus]}
                      </span>
                    </div>
                    <div className="text-secondary">{formatDateTime(event.createdAt)}</div>
                    <div className="text-secondary">by {event.actorRepr || "—"}</div>
                    {event.note && <div className="fst-italic">{event.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="col-lg-5">
          <Section title="Decision" icon="bi-sliders">
            <DecisionPanel
              requestId={request.id}
              currentStatus={request.status}
              allowed={allowed}
              availableAssets={candidateAssets}
              issuedAssetIds={request.issuedAssets.map((a) => a.id)}
              csrfToken={csrfToken}
            />
          </Section>

          <Section title="Requester" icon="bi-person">
            <dl className="mb-0">
              <DefinitionRow label="Name">
                {request.employee ? (
                  <Link href={`/employees/${request.employee.id}/`}>{request.employee.fullName}</Link>
                ) : (
                  request.requesterName
                )}
              </DefinitionRow>
              <DefinitionRow label="Email">
                <a href={`mailto:${request.requesterEmail}`}>{request.requesterEmail}</a>
              </DefinitionRow>
              <DefinitionRow label="Department" hidden={!request.department}>
                {request.department}
              </DefinitionRow>
              <DefinitionRow label="Job title" hidden={!request.employee?.jobTitle}>
                {request.employee?.jobTitle}
              </DefinitionRow>
              <DefinitionRow label="Country">{countryName(request.country)}</DefinitionRow>
              <DefinitionRow label="Site" hidden={!request.siteName && !request.site}>
                {request.site?.name ?? request.siteName}
              </DefinitionRow>
              {!request.employee && (
                <DefinitionRow label="">
                  <span className="small text-warning">
                    <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                    No employee record matches that email address.
                  </span>
                </DefinitionRow>
              )}
            </dl>
          </Section>

          <Section title="Record" icon="bi-info-circle">
            <dl className="mb-0">
              <DefinitionRow label="Raised">{formatDateTime(request.createdAt)}</DefinitionRow>
              <DefinitionRow label="Last decision" hidden={!request.decidedAt}>
                {formatDateTime(request.decidedAt)}
                {request.decidedBy && (
                  <div className="small text-secondary">
                    by{" "}
                    {`${request.decidedBy.firstName} ${request.decidedBy.lastName}`.trim() ||
                      request.decidedBy.username}
                  </div>
                )}
              </DefinitionRow>
              <DefinitionRow label="Issued" hidden={!request.issuedAt}>
                {formatDateTime(request.issuedAt)}
              </DefinitionRow>
              <DefinitionRow label="Latest note" hidden={!request.decisionNote}>
                <span style={{ whiteSpace: "pre-wrap" }}>{request.decisionNote}</span>
              </DefinitionRow>
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}
