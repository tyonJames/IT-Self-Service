import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  assertCanViewTicket,
  canSeeInternalComments,
  isAgentOrAdmin,
  requireAuthenticatedUser,
} from "@/lib/permissions";
import { ticketRepository } from "@/repositories/ticket.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { userService } from "@/services/user.service";
import { currentCsrfToken } from "@/lib/security/csrf";
import { countryColour, countryName } from "@/lib/config/countries";
import { evaluateSla, resolutionHours, SLA_TARGET_HOURS } from "@/lib/sla/sla";
import { humaniseDuration } from "@/lib/sla/workhours";
import { formatBytes, formatDateTime, formatRelative, initials } from "@/lib/utils/format";
import {
  ticketReference,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_VARIANTS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANTS,
} from "@/lib/domain/tickets";
import { ASSET_CATEGORY_LABELS } from "@/lib/domain/assets";
import { DefinitionRow, PageHeader, Section } from "@/components/ui";
import {
  AssignPanel,
  AttachmentUploadForm,
  CommentForm,
  StatusPanel,
} from "@/components/tickets/TicketPanels";
import { closeTicket, deleteTicket, deleteTicketAttachment } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const ticketId = Number.parseInt(id, 10);
  return { title: Number.isSafeInteger(ticketId) ? ticketReference(ticketId) : "Ticket" };
}

/** `/tickets/{id}/` — the full ticket view (spec §5.6). */
export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticketId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) notFound();

  const session = await requireAuthenticatedUser(`/tickets/${ticketId}/`);
  const ticket = await ticketRepository.findById(ticketId);
  if (!ticket) notFound();

  // Object-level authorisation, after the fetch and before anything renders.
  assertCanViewTicket(session, ticket);

  const agent = isAgentOrAdmin(session.user.role);
  const showInternal = canSeeInternalComments(session);

  const [categories, agents, csrfToken] = await Promise.all([
    lookupRepository.ticketCategoryLabels(),
    agent ? userService.assignableAgents() : Promise.resolve([]),
    currentCsrfToken(),
  ]);

  const sla = evaluateSla({ dueDate: ticket.dueDate, resolvedAt: ticket.resolvedAt });
  const resolved = resolutionHours(ticket);
  const accent = countryColour(ticket.country);
  const comments = ticket.comments.filter((c) => showInternal || !c.isInternal);
  const reference = ticketReference(ticket.id);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/tickets/">Tickets</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            {reference}
          </li>
        </ol>
      </nav>

      <div
        className="country-accent bg-white rounded p-3 mb-3"
        style={{ ["--country-accent" as string]: accent }}
      >
        <PageHeader
          title={`${reference} — ${ticket.title}`}
          subtitle={`${countryName(ticket.country)}${ticket.siteName ? ` · ${ticket.siteName}` : ""} · raised ${formatRelative(ticket.createdAt)}`}
          actions={
            agent ? (
              <>
                {ticket.status !== "closed" && (
                  <form action={closeTicket}>
                    <input type="hidden" name="csrf_token" value={csrfToken} />
                    <input type="hidden" name="ticketId" value={ticket.id} />
                    <button type="submit" className="btn btn-outline-secondary btn-sm">
                      <i className="bi bi-archive me-1" aria-hidden="true" />
                      Close ticket
                    </button>
                  </form>
                )}
                <form action={deleteTicket}>
                  <input type="hidden" name="csrf_token" value={csrfToken} />
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <button type="submit" className="btn btn-outline-danger btn-sm">
                    <i className="bi bi-trash3 me-1" aria-hidden="true" />
                    Delete
                  </button>
                </form>
              </>
            ) : undefined
          }
        />

        <div className="d-flex flex-wrap gap-2">
          <span className={`badge bg-${TICKET_STATUS_VARIANTS[ticket.status]}`}>
            {TICKET_STATUS_LABELS[ticket.status]}
          </span>
          <span className={`badge bg-${TICKET_PRIORITY_VARIANTS[ticket.priority]}`}>
            {TICKET_PRIORITY_LABELS[ticket.priority]} · {SLA_TARGET_HOURS[ticket.priority]}h target
          </span>
          <span className="badge bg-light text-dark border">
            {categories.get(ticket.category) ?? ticket.category}
          </span>
          {ticket.dueDate && (
            <span className={`badge bg-${sla.variant === "success" ? "success" : sla.variant}`}>
              <i className={`bi ${sla.isOverdue ? "bi-alarm" : "bi-clock"} me-1`} aria-hidden="true" />
              {sla.label}
            </span>
          )}
          {ticket.submittedPublicly && (
            <span className="badge bg-light text-dark border" title="Submitted through the public portal">
              <i className="bi bi-globe me-1" aria-hidden="true" />
              Public submission
            </span>
          )}
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-8">
          <Section title="The problem" icon="bi-card-text">
            <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {ticket.description}
            </p>
          </Section>

          <Section
            title={`Conversation (${comments.length})`}
            icon="bi-chat-left-text"
          >
            {comments.length === 0 ? (
              <p className="text-secondary small mb-3">
                Nothing yet. A reply here is emailed to the reporter.
              </p>
            ) : (
              <ul className="list-unstyled mb-3">
                {comments.map((comment) => {
                  const author = comment.author
                    ? `${comment.author.firstName} ${comment.author.lastName}`.trim() ||
                      comment.author.username
                    : ticket.submitterName || "Reporter";
                  return (
                    <li
                      key={comment.id.toString()}
                      className={`border rounded p-2 mb-2 ${comment.isInternal ? "bg-warning-subtle border-warning-subtle" : "bg-light border-light-subtle"}`}
                    >
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <span className="avatar-chip" aria-hidden="true">
                          {initials(author)}
                        </span>
                        <span className="fw-medium small">{author}</span>
                        {comment.isInternal && (
                          <span className="badge bg-warning text-dark">
                            <i className="bi bi-eye-slash me-1" aria-hidden="true" />
                            Internal
                          </span>
                        )}
                        <span className="text-secondary small ms-auto" title={formatDateTime(comment.createdAt)}>
                          {formatRelative(comment.createdAt)}
                        </span>
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{comment.body}</div>
                    </li>
                  );
                })}
              </ul>
            )}

            <CommentForm ticketId={ticket.id} canPostInternal={showInternal} csrfToken={csrfToken} />
          </Section>

          <Section title={`Attachments (${ticket.attachments.length})`} icon="bi-paperclip">
            {ticket.attachments.length === 0 ? (
              <p className="text-secondary small">No files attached.</p>
            ) : (
              <ul className="list-group list-group-flush mb-3">
                {ticket.attachments.map((attachment) => (
                  <li
                    key={attachment.id.toString()}
                    className="list-group-item d-flex align-items-center justify-content-between px-0"
                  >
                    <span className="text-truncate">
                      <i className="bi bi-file-earmark me-2 text-secondary" aria-hidden="true" />
                      <a href={`/tickets/attachments/${attachment.id}/download/`}>{attachment.filename}</a>
                      <span className="text-secondary small ms-2">{formatBytes(attachment.sizeBytes)}</span>
                    </span>
                    {agent && (
                      <form action={deleteTicketAttachment}>
                        <input type="hidden" name="csrf_token" value={csrfToken} />
                        <input type="hidden" name="attachmentId" value={attachment.id.toString()} />
                        <button
                          type="submit"
                          className="btn btn-sm btn-link text-danger"
                          aria-label={`Delete ${attachment.filename}`}
                        >
                          <i className="bi bi-trash3" aria-hidden="true" />
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <AttachmentUploadForm ticketId={ticket.id} csrfToken={csrfToken} />
          </Section>
        </div>

        <div className="col-lg-4">
          {agent && (
            <>
              <Section title="Update" icon="bi-sliders">
                <StatusPanel ticketId={ticket.id} currentStatus={ticket.status} csrfToken={csrfToken} />
                <hr />
                <AssignPanel
                  ticketId={ticket.id}
                  currentAssignee={ticket.assignedToId}
                  agents={agents.map((a) => ({
                    id: a.id,
                    label: `${a.firstName} ${a.lastName}`.trim() || a.username,
                  }))}
                  csrfToken={csrfToken}
                />
              </Section>
            </>
          )}

          <Section title="Reporter" icon="bi-person">
            <dl className="mb-0">
              <DefinitionRow label="Name">
                {ticket.employee ? (
                  <Link href={`/employees/${ticket.employee.id}/`}>{ticket.employee.fullName}</Link>
                ) : (
                  ticket.submitterName || "—"
                )}
              </DefinitionRow>
              <DefinitionRow label="Email">
                {ticket.submitterEmail ? (
                  <a href={`mailto:${ticket.submitterEmail}`}>{ticket.submitterEmail}</a>
                ) : (
                  "—"
                )}
              </DefinitionRow>
              <DefinitionRow label="Department" hidden={!ticket.employee?.department}>
                {ticket.employee?.department}
              </DefinitionRow>
              <DefinitionRow label="Country">{countryName(ticket.country)}</DefinitionRow>
              <DefinitionRow label="Site" hidden={!ticket.siteName}>
                {ticket.siteName}
              </DefinitionRow>
              <DefinitionRow label="AnyDesk ID" hidden={!ticket.anydeskId}>
                <code>{ticket.anydeskId}</code>
              </DefinitionRow>
            </dl>
          </Section>

          <Section title="Device" icon="bi-hdd">
            {ticket.asset ? (
              <dl className="mb-0">
                <DefinitionRow label="Asset">
                  <Link href={`/assets/${ticket.asset.id}/`}>
                    {ticket.asset.assetTag ?? `Asset #${ticket.asset.id}`}
                  </Link>
                </DefinitionRow>
                <DefinitionRow label="Type">
                  {ASSET_CATEGORY_LABELS[ticket.asset.category]}
                </DefinitionRow>
                <DefinitionRow label="Make / model">
                  {`${ticket.asset.brand} ${ticket.asset.model}`.trim() || "—"}
                </DefinitionRow>
                <DefinitionRow label="Serial" hidden={!ticket.asset.serialNumber}>
                  <code>{ticket.asset.serialNumber}</code>
                </DefinitionRow>
              </dl>
            ) : (
              <dl className="mb-0">
                <DefinitionRow label="Device type">{ticket.deviceType || "Not specified"}</DefinitionRow>
                <DefinitionRow label="Asset number given">
                  {ticket.assetNumber || <span className="text-secondary">None</span>}
                </DefinitionRow>
                {agent && ticket.assetNumber && (
                  <DefinitionRow label="">
                    <Link className="small" href={`/assets/?q=${encodeURIComponent(ticket.assetNumber)}`}>
                      Find this asset in the register
                    </Link>
                  </DefinitionRow>
                )}
              </dl>
            )}
          </Section>

          <Section title="Timing" icon="bi-clock-history">
            <dl className="mb-0">
              <DefinitionRow label="Raised">{formatDateTime(ticket.createdAt)}</DefinitionRow>
              <DefinitionRow label="SLA due">
                {ticket.dueDate ? formatDateTime(ticket.dueDate) : "—"}
              </DefinitionRow>
              <DefinitionRow label="Resolved" hidden={!ticket.resolvedAt}>
                {formatDateTime(ticket.resolvedAt)}
              </DefinitionRow>
              <DefinitionRow label="Time taken" hidden={resolved === null}>
                {humaniseDuration(resolved)} of working time
              </DefinitionRow>
              <DefinitionRow label="Last updated">{formatDateTime(ticket.updatedAt)}</DefinitionRow>
              <DefinitionRow label="Assigned to">
                {ticket.assignedTo
                  ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`.trim() ||
                    ticket.assignedTo.username
                  : "Nobody yet"}
              </DefinitionRow>
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}
