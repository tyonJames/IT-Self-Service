import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { equipmentRepository } from "@/repositories/equipment.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { countryName } from "@/lib/config/countries";
import { formatDateTime } from "@/lib/utils/format";
import { supportContact } from "@/lib/config/support";

export const metadata: Metadata = {
  title: "Equipment request received",
};

export const dynamic = "force-dynamic";

/**
 * `/request-equipment/sent/{id}/` — confirmation (spec §5.2).
 *
 * This page has no session, so it shows only what the requester typed
 * themselves: their own name, the items, the reason. It never shows the
 * decision note, who decided, issued assets, or anything else internal — the
 * id is guessable, so the projection is deliberately narrow
 * (`findPublicConfirmation`).
 */
export default async function EquipmentSentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const requestId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) notFound();

  const [request, labels] = await Promise.all([
    equipmentRepository.findPublicConfirmation(requestId),
    lookupRepository.equipmentItemTypeLabels(),
  ]);

  if (!request) notFound();

  const support = supportContact();
  const items = request.items.map((item) => {
    const label = labels.get(item.item) ?? item.item;
    return item.quantity > 1 ? `${item.quantity} × ${label}` : label;
  });

  return (
    <div className="row justify-content-center">
      <div className="col-lg-7">
        <div className="card">
          <div className="card-body p-4">
            <div className="text-center">
              <i className="bi bi-check-circle display-5 text-success" aria-hidden="true" />
              <h1 className="h4 mt-3">Request #{request.id} received</h1>
              <p className="text-secondary">
                Thanks, {request.requesterName.split(" ")[0]}. IT will review this and email you the
                outcome.
              </p>
            </div>

            <hr />

            <dl className="row mb-0 small">
              <dt className="col-sm-4 text-secondary fw-normal">Requested</dt>
              <dd className="col-sm-8">{formatDateTime(request.createdAt)}</dd>

              <dt className="col-sm-4 text-secondary fw-normal">Items</dt>
              <dd className="col-sm-8">
                {items.length > 0 ? (
                  <ul className="list-unstyled mb-0">
                    {items.map((item) => (
                      <li key={item}>
                        <i className="bi bi-dot" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-secondary">—</span>
                )}
                {request.otherEquipment && (
                  <div className="mt-1">
                    <span className="text-secondary">Also: </span>
                    {request.otherEquipment}
                  </div>
                )}
              </dd>

              <dt className="col-sm-4 text-secondary fw-normal">Priority</dt>
              <dd className="col-sm-8 text-capitalize">{request.priority}</dd>

              <dt className="col-sm-4 text-secondary fw-normal">Location</dt>
              <dd className="col-sm-8">
                {countryName(request.country)}
                {request.siteName ? ` — ${request.siteName}` : ""}
              </dd>

              <dt className="col-sm-4 text-secondary fw-normal">Status</dt>
              <dd className="col-sm-8">
                <span className="badge bg-primary text-capitalize">{request.status}</span>
              </dd>
            </dl>

            <hr />

            <p className="small text-secondary text-center mb-3">
              Keep this number handy — quote <strong>#{request.id}</strong> if you chase it up
              {support.phone ? ` on ${support.phone}` : ""}.
            </p>

            <div className="d-flex gap-2 justify-content-center">
              <Link className="btn btn-outline-primary" href="/request-equipment/">
                Make another request
              </Link>
              <Link className="btn btn-outline-secondary" href="/help/">
                Back to the portal
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
