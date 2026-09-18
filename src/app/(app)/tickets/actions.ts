"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ticketService } from "@/services/ticket.service";
import { ticketRepository } from "@/repositories/ticket.repository";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { clientIp } from "@/lib/security/request";
import {
  assertCanModifyTicket,
  assertCanViewTicket,
  requireAgent,
  requireAuthenticatedUser,
  ForbiddenError,
} from "@/lib/permissions";
import {
  commentSchema,
  ticketAssignSchema,
  ticketStatusChangeSchema,
  ticketUpdateSchema,
} from "@/lib/validation/tickets";
import { filesFromFormData, formDataToObject } from "@/lib/validation/common";
import { errorState, successState, zodErrorState, type FormState } from "@/lib/utils/result";
import { UploadRejectedError } from "@/lib/security/uploads";
import { logger } from "@/lib/logging/logger";

/**
 * Ticket Server Actions.
 *
 * Each one re-establishes the session and re-checks authorisation. A Server
 * Action is a public HTTP endpoint with an obscure name — the fact that the
 * page rendering the form was itself guarded proves nothing about who is
 * calling the action (instruction §8, §10).
 */

async function guard(formData: FormData) {
  await assertCsrf(formData);
  return requireAgent();
}

export async function changeTicketStatus(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await guard(formData);
    assertCanModifyTicket(session);

    const parsed = ticketStatusChangeSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await ticketService.changeStatus(
      session,
      parsed.data.ticketId,
      parsed.data.status as never,
      parsed.data.note,
      await clientIp(),
    );

    revalidatePath(`/tickets/${parsed.data.ticketId}/`);
    revalidatePath("/tickets/");
    return successState("Status updated and the reporter has been emailed.");
  } catch (error) {
    return toFormState(error, "changeTicketStatus");
  }
}

export async function assignTicket(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await guard(formData);
    assertCanModifyTicket(session);

    const parsed = ticketAssignSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    await ticketService.assign(session, parsed.data.ticketId, parsed.data.assignedToId, await clientIp());

    revalidatePath(`/tickets/${parsed.data.ticketId}/`);
    revalidatePath("/tickets/");
    return successState(parsed.data.assignedToId ? "Ticket assigned." : "Ticket unassigned.");
  } catch (error) {
    return toFormState(error, "assignTicket");
  }
}

export async function updateTicket(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await guard(formData);
    assertCanModifyTicket(session);

    const parsed = ticketUpdateSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const { ticketId, ...rest } = parsed.data;
    await ticketService.update(session, ticketId, {
      priority: rest.priority as never,
      category: rest.category,
      employeeId: rest.employeeId,
      assetId: rest.assetId,
      deviceType: rest.deviceType,
      anydeskId: rest.anydeskId,
      siteName: rest.siteName,
      country: rest.country,
    });

    revalidatePath(`/tickets/${ticketId}/`);
    return successState("Ticket updated.");
  } catch (error) {
    return toFormState(error, "updateTicket");
  }
}

/**
 * Add a comment. Unlike the other actions this one is open to staff, because
 * a reporter replying on their own ticket is the point — so it checks
 * *view* permission on that specific ticket, and forces `isInternal` off for
 * anyone who is not an agent.
 */
export async function addComment(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAuthenticatedUser();

    const parsed = commentSchema.safeParse(formDataToObject(formData));
    if (!parsed.success) return zodErrorState(parsed.error);

    const facts = await ticketRepository.findOwnershipFacts(parsed.data.ticketId);
    if (!facts) return errorState("That ticket no longer exists.");
    assertCanViewTicket(session, facts);

    const isAgent = session.user.role === "agent" || session.user.role === "admin";

    await ticketService.addComment(
      session,
      parsed.data.ticketId,
      parsed.data.body,
      isAgent ? parsed.data.isInternal : false,
    );

    revalidatePath(`/tickets/${parsed.data.ticketId}/`);
    return successState(
      isAgent && parsed.data.isInternal ? "Internal note added." : "Reply added and emailed.",
    );
  } catch (error) {
    return toFormState(error, "addComment");
  }
}

export async function uploadTicketAttachments(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAuthenticatedUser();

    const ticketId = Number.parseInt(String(formData.get("ticketId") ?? ""), 10);
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
      return errorState("That ticket could not be found.");
    }

    const facts = await ticketRepository.findOwnershipFacts(ticketId);
    if (!facts) return errorState("That ticket no longer exists.");
    assertCanViewTicket(session, facts);

    const files = filesFromFormData(formData, "attachments").slice(0, 5);
    if (files.length === 0) return errorState("Choose at least one file to attach.");

    const count = await ticketService.addAttachments(session, ticketId, files);

    revalidatePath(`/tickets/${ticketId}/`);
    return successState(`${count} file${count === 1 ? "" : "s"} attached.`);
  } catch (error) {
    return toFormState(error, "uploadTicketAttachments");
  }
}

export async function deleteTicketAttachment(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const attachmentId = BigInt(String(formData.get("attachmentId") ?? "0"));
  if (attachmentId <= 0n) throw new ForbiddenError("That attachment could not be found.");

  const ticketId = await ticketService.deleteAttachment(session, attachmentId);
  revalidatePath(`/tickets/${ticketId}/`);
}

export async function deleteTicket(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const ticketId = Number.parseInt(String(formData.get("ticketId") ?? ""), 10);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
    throw new ForbiddenError("That ticket could not be found.");
  }

  await ticketService.softDelete(session, ticketId, await clientIp());

  revalidatePath("/tickets/");
  revalidatePath("/manage/recycle-bin/");
  redirect("/tickets/?deleted=1");
}

/** Close a ticket — the dedicated `/tickets/{id}/close/` action from spec §4. */
export async function closeTicket(formData: FormData): Promise<void> {
  await assertCsrf(formData);
  const session = await requireAgent();

  const ticketId = Number.parseInt(String(formData.get("ticketId") ?? ""), 10);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
    throw new ForbiddenError("That ticket could not be found.");
  }

  await ticketService.changeStatus(
    session,
    ticketId,
    "closed",
    String(formData.get("note") ?? ""),
    await clientIp(),
  );

  revalidatePath(`/tickets/${ticketId}/`);
  revalidatePath("/tickets/");
}

/** Translate a thrown error into a FormState the form can render. */
function toFormState(error: unknown, context: string): FormState {
  if (error instanceof CsrfError) return errorState(error.message);
  if (error instanceof ForbiddenError) return errorState(error.message);
  if (error instanceof UploadRejectedError) return errorState(error.message);

  // `redirect()` throws a control-flow signal that must not be swallowed.
  if (typeof error === "object" && error !== null && "digest" in error) throw error;

  logger().error({ context, err: (error as Error).message }, "Ticket action failed");
  return errorState("Something went wrong. The problem has been logged — please try again.");
}
