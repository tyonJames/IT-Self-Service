import type { NextRequest } from "next/server";
import { z } from "zod";
import { deviceService } from "@/services/device.service";
import { clientIpFromHeaders } from "@/lib/security/request";
import { rateLimiter } from "@/lib/security/rate-limit";
import { fail, handleApiError, ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * `POST /device/report/` — a check-in from the tracking agent (spec §5.16).
 *
 * Authenticated by the device key, which may arrive either as a bearer token
 * or in the body (the PowerShell agent posts it in the body). The key is never
 * logged, never echoed, and is compared against a stored digest.
 *
 * The public IP is taken from the connection, not from the body: a device
 * cannot be trusted to report its own location truthfully.
 */
const reportSchema = z.object({
  device_key: z.string().max(128).optional(),
  hostname: z.string().max(120).optional().default(""),
  logged_in_user: z.string().max(120).optional().default(""),
  wifi_ssid: z.string().max(120).optional().default(""),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  gps_accuracy_m: z.number().min(0).max(100000).nullable().optional(),
  agent_version: z.string().max(40).optional().default(""),
  notes: z.string().max(500).optional().default(""),
});

export async function POST(request: NextRequest) {
  try {
    const ip = clientIpFromHeaders(request.headers);

    const limit = await rateLimiter().hit(`device:report:${ip}`, 240, 3600);
    if (!limit.allowed) {
      return fail(429, "rate_limited", "Check in less often.");
    }

    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return fail(400, "bad_request", "Send a JSON body.");
    }

    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(422, "validation_error", "The check-in payload is not valid.");
    }

    const header = request.headers.get("authorization") ?? "";
    const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    const deviceKey = bearer || parsed.data.device_key || "";

    if (!deviceKey) {
      return fail(401, "device_auth_failed", "Device authentication failed.");
    }

    // Throws DeviceAuthError (→ 401) on an unknown or rotated key.
    const assetId = await deviceService.authenticate(deviceKey, ip);

    await deviceService.recordCheckin(assetId, {
      hostname: parsed.data.hostname,
      loggedInUser: parsed.data.logged_in_user,
      wifiSsid: parsed.data.wifi_ssid,
      publicIp: ip === "unknown" ? null : ip,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      gpsAccuracyM: parsed.data.gps_accuracy_m ?? null,
      agentVersion: parsed.data.agent_version,
      notes: parsed.data.notes,
    });

    return ok({ status: "recorded", asset_id: assetId });
  } catch (error) {
    return handleApiError(error, "POST /device/report");
  }
}
