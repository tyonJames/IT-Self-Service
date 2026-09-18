import type { NextRequest } from "next/server";
import { z } from "zod";
import { deviceService } from "@/services/device.service";
import { clientIpFromHeaders } from "@/lib/security/request";
import { rateLimiter } from "@/lib/security/rate-limit";
import { fail, handleApiError, ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * `POST /device/enrol/` — the tracking agent registering itself (spec §5.16).
 *
 * The device is identified by serial number, which must already exist on an
 * asset. A fresh 64-character key is generated and returned **once**; only its
 * digest is stored (CC-004), so this response is the single opportunity to
 * capture it.
 *
 * No session is involved — this is a machine endpoint — so it is rate limited
 * per IP to stop it being used to probe which serial numbers exist.
 */
const enrolSchema = z.object({
  serial_number: z.string().min(1).max(120),
  hostname: z.string().max(120).optional().default(""),
  agent_version: z.string().max(40).optional().default(""),
});

export async function POST(request: NextRequest) {
  try {
    const ip = clientIpFromHeaders(request.headers);

    const limit = await rateLimiter().hit(`device:enrol:${ip}`, 20, 3600);
    if (!limit.allowed) {
      return fail(429, "rate_limited", "Too many enrolment attempts. Try again later.");
    }

    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return fail(400, "bad_request", "Send a JSON body.");
    }

    const parsed = enrolSchema.safeParse(body);
    if (!parsed.success) {
      return fail(422, "validation_error", "serial_number is required.");
    }

    const result = await deviceService.enrol(parsed.data.serial_number, parsed.data.hostname, ip);

    // The key appears here and nowhere else, ever.
    return ok({
      asset_id: result.assetId,
      asset_tag: result.assetTag,
      device_key: result.deviceKey,
      report_url: "/device/report/",
      message: "Enrolled. Store this key securely — it cannot be retrieved again.",
    });
  } catch (error) {
    return handleApiError(error, "POST /device/enrol");
  }
}
