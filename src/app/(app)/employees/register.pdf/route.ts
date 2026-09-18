import { NextResponse } from "next/server";
import { requireApiAgent } from "@/lib/permissions";
import { exportService } from "@/services/export.service";
import { auditService } from "@/services/audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { handleApiError } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/** `/employees/register.pdf` — printable email register (spec §5.12). */
export async function GET() {
  try {
    const session = await requireApiAgent();
    const buffer = await exportService.emailRegisterToPdf();

    await auditService.record({
      event: SecurityEvent.FILE_ACCESS,
      message: "Exported the employee email register (PDF)",
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Employee",
    });

    const filename = `radx-email-register-${new Date().toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, "GET /employees/register.pdf");
  }
}
