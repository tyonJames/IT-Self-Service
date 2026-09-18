import { NextResponse, type NextRequest } from "next/server";
import { ticketRepository } from "@/repositories/ticket.repository";
import { assertCanViewTicket, requireApiUser } from "@/lib/permissions";
import { storage, StorageObjectNotFoundError } from "@/lib/storage";
import { attachmentDisposition } from "@/lib/security/uploads";
import { auditService } from "@/services/audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { clientIpFromHeaders } from "@/lib/security/request";
import { fail, handleApiError } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * Authenticated attachment download (spec §3.10, note 4).
 *
 * Uploaded files are never served from a public URL. Every download:
 *  1. requires a session,
 *  2. re-checks that this user may view *that* ticket (the IDOR defence),
 *  3. streams the bytes out of the storage provider,
 *  4. forces `Content-Disposition: attachment` so a stored HTML or SVG file
 *     can never execute in the application's origin,
 *  5. is written to the audit log.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireApiUser();
    const { id } = await params;

    let attachmentId: bigint;
    try {
      attachmentId = BigInt(id);
    } catch {
      return fail(404, "not_found", "That file could not be found.");
    }

    const attachment = await ticketRepository.findAttachment(attachmentId);

    // A deleted ticket's attachments are not downloadable — the record is in
    // the recycle bin, and so is everything hanging off it.
    if (!attachment || attachment.ticket.isDeleted) {
      return fail(404, "not_found", "That file could not be found.");
    }

    assertCanViewTicket(session, attachment.ticket);

    let bytes: Buffer;
    try {
      bytes = await storage().get(attachment.storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        return fail(404, "not_found", "That file is no longer in storage.");
      }
      throw error;
    }

    await auditService.record({
      event: SecurityEvent.FILE_ACCESS,
      message: `Downloaded ${attachment.filename} from ticket #${attachment.ticketId}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "TicketAttachment",
      targetId: attachmentId,
      ipAddress: clientIpFromHeaders(request.headers),
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": attachmentDisposition(attachment.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, "GET /tickets/attachments/[id]/download");
  }
}
