import type { NextRequest } from "next/server";
import { recycleBinService } from "@/services/recyclebin.service";
import { notificationService } from "@/services/notification.service";
import { purgeExpiredSessions } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { timingSafeEqualString } from "@/lib/security/tokens";
import { clientIpFromHeaders } from "@/lib/security/request";
import { SecurityEvent, securityLog } from "@/lib/logging/logger";
import { auditService } from "@/services/audit.service";
import { fail, handleApiError, ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * `POST /api/jobs/purge` — the scheduled housekeeping job (instruction §22).
 *
 * Azure App Service has no dependable cron, and a background timer inside a
 * web app dies with the instance or runs N times when you scale out. So the
 * job is an HTTP endpoint protected by a shared secret, invoked by an Azure
 * scheduler (Logic App, Function timer trigger, or WebJob — see
 * AZURE_DEPLOYMENT.md §15). Whatever calls it, exactly one instance does the
 * work, and the run is visible in the audit log.
 *
 * It does four things:
 *   1. hard-deletes soft-deleted records past the retention window, and their blobs,
 *   2. removes expired sessions,
 *   3. expires used and stale password-reset tokens,
 *   4. retries failed notifications.
 */
function authorise(request: NextRequest): boolean {
  const configured = env().JOB_TRIGGER_SECRET;
  if (!configured) return false;

  const header =
    request.headers.get("x-job-secret") ??
    (request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
      ? request.headers.get("authorization")!.slice(7).trim()
      : "");

  return Boolean(header) && timingSafeEqualString(header, configured);
}

async function run() {
  const started = Date.now();

  const purged = await recycleBinService.purgeExpired();
  const sessions = await purgeExpiredSessions();

  const tokens = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lte: new Date() } }, { usedAt: { not: null } }],
    },
  });

  const notifications = await notificationService.retryAllFailed(200);

  const result = {
    purged,
    expiredSessionsRemoved: sessions,
    expiredResetTokensRemoved: tokens.count,
    notifications,
    durationMs: Date.now() - started,
  };

  await auditService.record({
    event: SecurityEvent.JOB_RUN,
    message: "Scheduled housekeeping job completed",
    actorRepr: "scheduled-job",
    target: "Job",
    detail: {
      assets: purged.assets,
      employees: purged.employees,
      tickets: purged.tickets,
      equipment: purged.equipment,
      sessions,
      resetTokens: tokens.count,
      notificationsAttempted: notifications.attempted,
      notificationsSent: notifications.sent,
      durationMs: result.durationMs,
    },
  });

  return result;
}

export async function POST(request: NextRequest) {
  try {
    if (!authorise(request)) {
      securityLog(SecurityEvent.AUTHZ_DENIED, "Scheduled job endpoint called without a valid secret", "WARNING", {
        ip: clientIpFromHeaders(request.headers),
      });
      return fail(401, "unauthorized", "Missing or invalid job secret.");
    }

    return ok(await run());
  } catch (error) {
    return handleApiError(error, "POST /api/jobs/purge");
  }
}

/** GET is accepted too, because some schedulers can only issue a GET. */
export async function GET(request: NextRequest) {
  return POST(request);
}
