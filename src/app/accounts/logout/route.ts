import { NextResponse, type NextRequest } from "next/server";
import { auth, destroySession } from "@/lib/auth/session";
import { assertCsrf } from "@/lib/security/csrf";
import { auditService } from "@/services/audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { clientIpFromHeaders } from "@/lib/security/request";
import { handleApiError } from "@/lib/api/respond";

/**
 * `/accounts/logout/` — POST only (spec §4).
 *
 * A GET logout can be fired by any `<img src>` on any page on the internet;
 * requiring a POST with a CSRF token means only a real click signs you out.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    await assertCsrf(formData);

    const session = await auth();
    await destroySession();

    if (session) {
      await auditService.record({
        event: SecurityEvent.LOGOUT,
        message: `${session.user.username} signed out`,
        actorId: session.user.id,
        actorRepr: session.user.username,
        ipAddress: clientIpFromHeaders(request.headers),
      });
    }

    return NextResponse.redirect(new URL("/accounts/login/", request.url), 303);
  } catch (error) {
    return handleApiError(error, "POST /accounts/logout");
  }
}

/** A GET is never a logout — send the browser back to where it came from. */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/tickets/reports/", request.url), 303);
}
