import { NextResponse, type NextRequest } from "next/server";
import { assetRepository } from "@/repositories/asset.repository";
import { requireApiAgent } from "@/lib/permissions";
import { storage, StorageObjectNotFoundError } from "@/lib/storage";
import { attachmentDisposition } from "@/lib/security/uploads";
import { auditService } from "@/services/audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { clientIpFromHeaders } from "@/lib/security/request";
import { fail, handleApiError } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * Authenticated asset-document download (spec §3.6).
 *
 * Asset documents are allocation forms and signed IT policies — agent-only,
 * never public, always forced as a download, always audited.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireApiAgent();
    const { id } = await params;

    let documentId: bigint;
    try {
      documentId = BigInt(id);
    } catch {
      return fail(404, "not_found", "That document could not be found.");
    }

    const document = await assetRepository.findDocument(documentId);
    if (!document || document.asset.isDeleted) {
      return fail(404, "not_found", "That document could not be found.");
    }

    let bytes: Buffer;
    try {
      bytes = await storage().get(document.storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        return fail(404, "not_found", "That document is no longer in storage.");
      }
      throw error;
    }

    await auditService.record({
      event: SecurityEvent.FILE_ACCESS,
      message: `Downloaded ${document.filename} from asset ${document.asset.assetTag ?? `#${document.assetId}`}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "AssetDocument",
      targetId: documentId,
      ipAddress: clientIpFromHeaders(request.headers),
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": attachmentDisposition(document.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, "GET /assets/doc/[id]/download");
  }
}
