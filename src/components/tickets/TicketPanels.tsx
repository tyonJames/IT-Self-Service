"use client";

import { useActionState } from "react";
import {
  addComment,
  assignTicket,
  changeTicketStatus,
  uploadTicketAttachments,
} from "@/app/(app)/tickets/actions";
import { IDLE_STATE } from "@/lib/utils/result";
import { FormMessage, TextArea } from "@/components/forms/FormField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { FileDropzone } from "@/components/forms/FileDropzone";
import { TICKET_ATTACHMENT_EXTENSIONS } from "@/lib/security/uploads-constants";
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from "@/lib/domain/tickets";
import type { TicketStatus } from "@prisma/client";

/** Status change with an optional note that becomes a public comment. */
export function StatusPanel({
  ticketId,
  currentStatus,
  csrfToken,
}: {
  ticketId: number;
  currentStatus: TicketStatus;
  csrfToken: string;
}) {
  const [state, action] = useActionState(changeTicketStatus, IDLE_STATE);

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="ticketId" value={ticketId} />

      <FormMessage state={state} />

      <div className="mb-2">
        <label className="form-label small mb-1" htmlFor="status">
          Status
        </label>
        <select className="form-select form-select-sm" id="status" name="status" defaultValue={currentStatus}>
          {TICKET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {TICKET_STATUS_LABELS[status as TicketStatus]}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="form-label small mb-1" htmlFor="note">
          Note to the reporter <span className="text-secondary">(optional)</span>
        </label>
        <textarea
          className="form-control form-control-sm"
          id="note"
          name="note"
          rows={2}
          maxLength={2000}
          placeholder="Included in the update email they receive."
        />
      </div>

      <SubmitButton size="sm" icon="bi-check2-circle" pendingLabel="Saving…" className="w-100">
        Update status
      </SubmitButton>
    </form>
  );
}

/** Assignment dropdown (agents only). */
export function AssignPanel({
  ticketId,
  currentAssignee,
  agents,
  csrfToken,
}: {
  ticketId: number;
  currentAssignee: number | null;
  agents: { id: number; label: string }[];
  csrfToken: string;
}) {
  const [state, action] = useActionState(assignTicket, IDLE_STATE);

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="ticketId" value={ticketId} />

      <FormMessage state={state} />

      <div className="mb-2">
        <label className="form-label small mb-1" htmlFor="assignedToId">
          Assigned to
        </label>
        <select
          className="form-select form-select-sm"
          id="assignedToId"
          name="assignedToId"
          defaultValue={currentAssignee ? String(currentAssignee) : ""}
        >
          <option value="">Nobody yet</option>
          {agents.map((agent) => (
            <option key={agent.id} value={String(agent.id)}>
              {agent.label}
            </option>
          ))}
        </select>
      </div>

      <SubmitButton size="sm" variant="outline-primary" icon="bi-person-check" className="w-100">
        Save assignment
      </SubmitButton>
    </form>
  );
}

/** Comment box. The internal-note toggle only renders for agents. */
export function CommentForm({
  ticketId,
  canPostInternal,
  csrfToken,
}: {
  ticketId: number;
  canPostInternal: boolean;
  csrfToken: string;
}) {
  const [state, action] = useActionState(addComment, IDLE_STATE);

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="ticketId" value={ticketId} />

      <FormMessage state={state} />

      <TextArea
        name="body"
        label="Add a reply"
        required
        rows={3}
        placeholder="What you have done, what you need from them, or what happens next."
        state={state}
      />

      <div className="d-flex flex-wrap align-items-center gap-3">
        <SubmitButton size="sm" icon="bi-send" pendingLabel="Posting…">
          Post reply
        </SubmitButton>

        {canPostInternal && (
          <div className="form-check mb-0">
            <input className="form-check-input" type="checkbox" id="isInternal" name="isInternal" />
            <label className="form-check-label small" htmlFor="isInternal">
              Internal note — not visible to the reporter, and no email is sent
            </label>
          </div>
        )}
      </div>
    </form>
  );
}

/** Attachment upload for an existing ticket. */
export function AttachmentUploadForm({
  ticketId,
  csrfToken,
}: {
  ticketId: number;
  csrfToken: string;
}) {
  const [state, action] = useActionState(uploadTicketAttachments, IDLE_STATE);

  return (
    <form action={action}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="ticketId" value={ticketId} />

      <FormMessage state={state} />

      <FileDropzone
        name="attachments"
        label="Add files"
        accept={TICKET_ATTACHMENT_EXTENSIONS.join(",")}
        maxFiles={5}
      />

      <SubmitButton size="sm" variant="outline-primary" icon="bi-paperclip" pendingLabel="Uploading…">
        Upload
      </SubmitButton>
    </form>
  );
}
