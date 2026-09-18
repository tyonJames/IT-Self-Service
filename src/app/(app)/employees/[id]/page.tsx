import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/permissions";
import { employeeRepository } from "@/repositories/employee.repository";
import { assetRepository } from "@/repositories/asset.repository";
import { ticketRepository } from "@/repositories/ticket.repository";
import { equipmentRepository } from "@/repositories/equipment.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { currentCsrfToken } from "@/lib/security/csrf";
import { countryColour, countryName } from "@/lib/config/countries";
import {
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANTS,
} from "@/lib/domain/assets";
import {
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUS_VARIANTS,
} from "@/lib/domain/equipment-status";
import {
  ticketReference,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANTS,
} from "@/lib/domain/tickets";
import { formatDate, formatDateTime, initials, isPasswordStale, splitName } from "@/lib/utils/format";
import { Alert, DefinitionRow, EmptyState, PageHeader, Section } from "@/components/ui";
import { TemporaryPasswordPanel } from "@/components/employees/EmployeePanels";
import { clearTemporaryPassword, deleteEmployee, offboardEmployee, reactivateEmployee } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Employee ${id}` };
}

/** `/employees/{id}/` — the employee 360 view (spec §5.9). */
export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAgent();

  const { id } = await params;
  const employeeId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) notFound();

  const employee = await employeeRepository.findById(employeeId);
  if (!employee) notFound();

  const [assets, tickets, requests, categories, itemLabels, csrfToken] = await Promise.all([
    assetRepository.listForEmployee(employeeId),
    ticketRepository.listForEmployee(employeeId),
    equipmentRepository.listForEmployee(employeeId),
    lookupRepository.ticketCategoryLabels(),
    lookupRepository.equipmentItemTypeLabels(),
    currentCsrfToken(),
  ]);

  const accent = countryColour(employee.site);
  const { firstName, surname } = splitName(employee.fullName);
  const openTickets = tickets.filter((t) => !["resolved", "closed"].includes(t.status)).length;
  const activeAssets = assets.filter((a) => !["retired", "stolen"].includes(a.status));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/employees/">Employees</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            {employee.fullName}
          </li>
        </ol>
      </nav>

      <div
        className="country-accent bg-white rounded p-3 mb-3"
        style={{ ["--country-accent" as string]: accent }}
      >
        <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
          <div className="d-flex align-items-center gap-3">
            <span className="avatar-chip" style={{ width: "3rem", height: "3rem", fontSize: "1rem" }} aria-hidden="true">
              {initials(employee.fullName)}
            </span>
            <div>
              <h1 className="h4 mb-1">{employee.fullName}</h1>
              <p className="text-secondary mb-0 small">
                {employee.jobTitle || "No job title on file"}
                {employee.department ? ` · ${employee.department}` : ""} · {countryName(employee.site)}
              </p>
            </div>
          </div>

          <div className="d-flex flex-wrap gap-2">
            <Link className="btn btn-outline-secondary btn-sm" href={`/employees/${employee.id}/edit/`}>
              <i className="bi bi-pencil me-1" aria-hidden="true" />
              Edit
            </Link>

            {employee.isActive ? (
              <form action={offboardEmployee}>
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <input type="hidden" name="employeeId" value={employee.id} />
                <button type="submit" className="btn btn-outline-warning btn-sm">
                  <i className="bi bi-box-arrow-right me-1" aria-hidden="true" />
                  Offboard
                </button>
              </form>
            ) : (
              <form action={reactivateEmployee}>
                <input type="hidden" name="csrf_token" value={csrfToken} />
                <input type="hidden" name="employeeId" value={employee.id} />
                <button type="submit" className="btn btn-outline-success btn-sm">
                  <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                  Reactivate
                </button>
              </form>
            )}

            <form action={deleteEmployee}>
              <input type="hidden" name="csrf_token" value={csrfToken} />
              <input type="hidden" name="employeeId" value={employee.id} />
              <button type="submit" className="btn btn-outline-danger btn-sm">
                <i className="bi bi-trash3 me-1" aria-hidden="true" />
                Delete
              </button>
            </form>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 mt-3">
          <span className={`badge bg-${employee.isActive ? "success" : "warning"}${employee.isActive ? "" : " text-dark"}`}>
            {employee.isActive ? "Active" : "Suspended"}
          </span>
          <span className="badge bg-light text-dark border text-capitalize">{employee.staffGroup}</span>
          <span className="badge bg-light text-dark border">
            <i className="bi bi-hdd me-1" aria-hidden="true" />
            {activeAssets.length} device{activeAssets.length === 1 ? "" : "s"}
          </span>
          <span className="badge bg-light text-dark border">
            <i className="bi bi-ticket me-1" aria-hidden="true" />
            {openTickets} open ticket{openTickets === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {!employee.isActive && activeAssets.length > 0 && (
        <Alert variant="warning" title="This person is suspended but still holds devices">
          {activeAssets.length} device{activeAssets.length === 1 ? " is" : "s are"} still on their name.
          Collect {activeAssets.length === 1 ? "it" : "them"} and reassign, or mark{" "}
          {activeAssets.length === 1 ? "it" : "them"} retired.
        </Alert>
      )}

      <div className="row g-3">
        <div className="col-lg-7">
          <Section title={`Devices (${assets.length})`} icon="bi-hdd-stack">
            {assets.length === 0 ? (
              <EmptyState icon="bi-hdd" title="No devices assigned to this person" />
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <caption className="visually-hidden">Devices assigned to {employee.fullName}</caption>
                  <thead className="table-light">
                    <tr>
                      <th scope="col">Tag</th>
                      <th scope="col">Type</th>
                      <th scope="col">Make / model</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => (
                      <tr key={asset.id}>
                        <th scope="row" className="fw-normal">
                          <Link href={`/assets/${asset.id}/`}>{asset.assetTag ?? `#${asset.id}`}</Link>
                        </th>
                        <td className="small">
                          <i
                            className={`bi ${ASSET_CATEGORY_ICONS[asset.category]} me-1 text-secondary`}
                            aria-hidden="true"
                          />
                          {ASSET_CATEGORY_LABELS[asset.category]}
                        </td>
                        <td className="small">{`${asset.brand} ${asset.model}`.trim() || "—"}</td>
                        <td>
                          <span className={`badge bg-${ASSET_STATUS_VARIANTS[asset.status]}`}>
                            {ASSET_STATUS_LABELS[asset.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`Ticket history (${tickets.length})`} icon="bi-ticket-detailed">
            {tickets.length === 0 ? (
              <EmptyState icon="bi-emoji-smile" title="This person has never raised a ticket" />
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <caption className="visually-hidden">Tickets raised by {employee.fullName}</caption>
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
                    {tickets.map((ticket) => (
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
                        <td className="small text-secondary">{formatDate(ticket.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={`Equipment requests (${requests.length})`} icon="bi-box-seam">
            {requests.length === 0 ? (
              <EmptyState icon="bi-box" title="No equipment requests from this person" />
            ) : (
              <ul className="list-group list-group-flush">
                {requests.map((request) => (
                  <li key={request.id} className="list-group-item px-0">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div>
                        <Link href={`/equipment/${request.id}/`} className="fw-medium text-decoration-none">
                          Request #{request.id}
                        </Link>
                        <div className="small text-secondary">
                          {request.items
                            .map((item) => {
                              const label = itemLabels.get(item.item) ?? item.item;
                              return item.quantity > 1 ? `${item.quantity} × ${label}` : label;
                            })
                            .join(", ") || "No items listed"}
                        </div>
                      </div>
                      <div className="text-end">
                        <span className={`badge bg-${EQUIPMENT_STATUS_VARIANTS[request.status]}`}>
                          {EQUIPMENT_STATUS_LABELS[request.status]}
                        </span>
                        <div className="small text-secondary">{formatDate(request.createdAt)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="col-lg-5">
          <Section title="Contact" icon="bi-person-lines-fill">
            <dl className="mb-0">
              <DefinitionRow label="First name">{firstName}</DefinitionRow>
              <DefinitionRow label="Surname" hidden={!surname}>
                {surname}
              </DefinitionRow>
              <DefinitionRow label="Work email">
                <a href={`mailto:${employee.email}`}>{employee.email}</a>
              </DefinitionRow>
              <DefinitionRow label="Other email" hidden={!employee.altEmail}>
                <a href={`mailto:${employee.altEmail}`}>{employee.altEmail}</a>
              </DefinitionRow>
              <DefinitionRow label="Phone" hidden={!employee.phone}>
                <a href={`tel:${employee.phone.replace(/\s/g, "")}`}>{employee.phone}</a>
              </DefinitionRow>
              <DefinitionRow label="Employee number" hidden={!employee.employeeNumber}>
                {employee.employeeNumber}
              </DefinitionRow>
              <DefinitionRow label="Login account">
                {employee.user ? (
                  <>
                    <code>{employee.user.username}</code>
                    {!employee.user.isActive && (
                      <span className="badge bg-warning text-dark ms-2">Disabled</span>
                    )}
                  </>
                ) : (
                  <span className="text-secondary">None</span>
                )}
              </DefinitionRow>
              <DefinitionRow label="Notes" hidden={!employee.notes}>
                <span style={{ whiteSpace: "pre-wrap" }}>{employee.notes}</span>
              </DefinitionRow>
            </dl>
          </Section>

          <Section
            title="Temporary mailbox password"
            icon="bi-shield-lock"
            actions={
              employee.emailPasswordEnc ? (
                <form action={clearTemporaryPassword}>
                  <input type="hidden" name="csrf_token" value={csrfToken} />
                  <input type="hidden" name="employeeId" value={employee.id} />
                  <button type="submit" className="btn btn-sm btn-link text-danger p-0">
                    Clear it
                  </button>
                </form>
              ) : undefined
            }
          >
            <TemporaryPasswordPanel
              employeeId={employee.id}
              hasPassword={Boolean(employee.emailPasswordEnc)}
              isStale={isPasswordStale(employee.emailPasswordSetAt)}
              setAtLabel={
                employee.emailPasswordSetAt ? formatDateTime(employee.emailPasswordSetAt) : "—"
              }
              csrfToken={csrfToken}
            />
          </Section>

          <Section title="Record" icon="bi-clock-history">
            <dl className="mb-0">
              <DefinitionRow label="Added">{formatDateTime(employee.createdAt)}</DefinitionRow>
              <DefinitionRow label="Last updated">{formatDateTime(employee.updatedAt)}</DefinitionRow>
              <DefinitionRow label="Country">{countryName(employee.site)}</DefinitionRow>
              <DefinitionRow label="Staff group">
                <span className="text-capitalize">{employee.staffGroup}</span>
              </DefinitionRow>
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}
