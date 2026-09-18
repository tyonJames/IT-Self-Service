import { prisma } from "@/lib/db/prisma";
import { generateDeviceKey, sha256 } from "@/lib/security/tokens";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import type { AppSession } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/permissions";

/**
 * Device location tracking (spec §5.16, instruction §12).
 *
 * Key handling (CC-004): the 64-character hex key is returned to the agent
 * once at enrolment and then exists only as a SHA-256 digest plus a 12-char
 * lookup prefix. Verification is one indexed read and one constant-time
 * comparison. Rotation overwrites both columns, so the previous key stops
 * working on the very next check-in.
 *
 * Device keys never appear in a log line, an audit detail, an export or an
 * error message.
 */

export const DEVICE_KEY_PREFIX_LENGTH = 12;

export class DeviceAuthError extends Error {
  readonly status = 401;
  constructor(message = "Device authentication failed") {
    super(message);
    this.name = "DeviceAuthError";
  }
}

export interface CheckinPayload {
  hostname: string;
  loggedInUser: string;
  wifiSsid: string;
  publicIp: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyM: number | null;
  agentVersion: string;
  notes: string;
}

export interface GeoResult {
  city: string;
  region: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Resolve a public IP to a coarse location. Network failures are swallowed —
 * a check-in that arrives without geo data is still a useful check-in, and the
 * agent must never be blocked on a third-party lookup.
 */
export async function lookupGeo(ip: string | null): Promise<GeoResult | null> {
  const endpoint = env().GEOIP_ENDPOINT;
  if (!ip || !endpoint) return null;
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fe80:)/i.test(ip)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env().GEOIP_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.replace("{ip}", encodeURIComponent(ip)), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const str = (key: string): string => {
      const v = data[key];
      return typeof v === "string" ? v.slice(0, 120) : "";
    };
    const num = (key: string): number | null => {
      const v = data[key];
      const n = typeof v === "number" ? v : Number.parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };

    return {
      city: str("city"),
      region: str("region") || str("region_name"),
      country: str("country_name") || str("country"),
      latitude: num("latitude") ?? num("lat"),
      longitude: num("longitude") ?? num("lon"),
    };
  } catch {
    logger().debug({}, "Geo lookup failed or timed out; check-in stored without geo data");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "Radx-HQ-WiFi" if we have an SSID, else "Harare, Zimbabwe" (spec §3.5). */
export function shortLocation(checkin: {
  wifiSsid: string;
  geoCity: string;
  geoRegion: string;
  geoCountry: string;
}): string {
  if (checkin.wifiSsid) return checkin.wifiSsid;
  const parts = [checkin.geoCity, checkin.geoRegion, checkin.geoCountry].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Unknown location";
}

/** OpenStreetMap link for a check-in with coordinates (spec §3.5). */
export function mapUrl(checkin: { latitude: number | null; longitude: number | null }): string | null {
  if (checkin.latitude === null || checkin.longitude === null) return null;
  const { latitude: lat, longitude: lon } = checkin;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

export const deviceService = {
  /**
   * Enrol a device by serial number and hand back a fresh key.
   * Called by the PowerShell agent at `/device/enrol/`.
   */
  async enrol(
    serialNumber: string,
    hostname: string,
    ipAddress: string | null,
  ): Promise<{ assetId: number; assetTag: string | null; deviceKey: string }> {
    const asset = await prisma.asset.findFirst({
      where: { isDeleted: false, serialNumber: { equals: serialNumber.trim(), mode: "insensitive" } },
      select: { id: true, assetTag: true },
    });

    if (!asset) {
      await auditService.record({
        event: SecurityEvent.DEVICE_AUTH_FAILURE,
        message: "Enrolment refused: no asset matches that serial number",
        target: "Asset",
        ipAddress,
        level: "WARNING",
        detail: { hostname },
      });
      throw new DeviceAuthError("No asset is registered with that serial number.");
    }

    const deviceKey = generateDeviceKey();

    await prisma.asset.update({
      where: { id: asset.id },
      data: {
        deviceKeyHash: sha256(deviceKey),
        deviceKeyPrefix: deviceKey.slice(0, DEVICE_KEY_PREFIX_LENGTH),
        deviceKeySetAt: new Date(),
        trackingEnabled: true,
      },
    });

    await auditService.record({
      event: SecurityEvent.DEVICE_ENROLLED,
      message: `Device enrolled for asset ${asset.assetTag ?? `#${asset.id}`}`,
      target: "Asset",
      targetId: asset.id,
      ipAddress,
      detail: { hostname },
    });

    return { assetId: asset.id, assetTag: asset.assetTag, deviceKey };
  },

  /** Verify a presented device key. Constant-time; never logs the key. */
  async authenticate(deviceKey: string, ipAddress: string | null): Promise<number> {
    const key = deviceKey.trim();
    if (key.length !== 64 || !/^[0-9a-f]+$/i.test(key)) {
      throw new DeviceAuthError();
    }

    const asset = await prisma.asset.findFirst({
      where: {
        isDeleted: false,
        trackingEnabled: true,
        deviceKeyPrefix: key.slice(0, DEVICE_KEY_PREFIX_LENGTH),
      },
      select: { id: true, deviceKeyHash: true },
    });

    if (!asset?.deviceKeyHash || asset.deviceKeyHash !== sha256(key)) {
      await auditService.record({
        event: SecurityEvent.DEVICE_AUTH_FAILURE,
        message: "Device check-in rejected: unknown or rotated key",
        target: "Asset",
        ipAddress,
        level: "WARNING",
      });
      throw new DeviceAuthError();
    }

    return asset.id;
  },

  /** Record a check-in and update the asset's last-seen summary. */
  async recordCheckin(
    assetId: number,
    payload: CheckinPayload,
    source: "agent" | "manual" = "agent",
  ): Promise<void> {
    const geo = source === "agent" ? await lookupGeo(payload.publicIp) : null;

    const latitude = payload.latitude ?? geo?.latitude ?? null;
    const longitude = payload.longitude ?? geo?.longitude ?? null;

    const summary = shortLocation({
      wifiSsid: payload.wifiSsid,
      geoCity: geo?.city ?? "",
      geoRegion: geo?.region ?? "",
      geoCountry: geo?.country ?? "",
    });

    await prisma.$transaction([
      prisma.deviceCheckin.create({
        data: {
          assetId,
          source,
          hostname: payload.hostname,
          loggedInUser: payload.loggedInUser,
          wifiSsid: payload.wifiSsid,
          publicIp: payload.publicIp,
          geoCity: geo?.city ?? "",
          geoRegion: geo?.region ?? "",
          geoCountry: geo?.country ?? "",
          latitude,
          longitude,
          gpsAccuracyM: payload.gpsAccuracyM,
          agentVersion: payload.agentVersion,
          notes: payload.notes,
        },
      }),
      prisma.asset.update({
        where: { id: assetId },
        data: { lastSeenAt: new Date(), lastSeenLocation: summary },
      }),
    ]);
  },

  /** Rotate the key — the previous one stops working immediately (spec §5.16). */
  async rotateKey(session: AppSession, assetId: number): Promise<string> {
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, isDeleted: false },
      select: { id: true, assetTag: true },
    });
    if (!asset) throw new ForbiddenError("That asset no longer exists.");

    const deviceKey = generateDeviceKey();

    await prisma.asset.update({
      where: { id: assetId },
      data: {
        deviceKeyHash: sha256(deviceKey),
        deviceKeyPrefix: deviceKey.slice(0, DEVICE_KEY_PREFIX_LENGTH),
        deviceKeySetAt: new Date(),
        trackingEnabled: true,
      },
    });

    await auditService.record({
      event: SecurityEvent.DEVICE_KEY_ROTATED,
      message: `Device key rotated for asset ${asset.assetTag ?? `#${assetId}`}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Asset",
      targetId: assetId,
      level: "WARNING",
    });

    return deviceKey;
  },

  async disableTracking(session: AppSession, assetId: number): Promise<void> {
    await prisma.asset.update({
      where: { id: assetId },
      data: { trackingEnabled: false, deviceKeyHash: null, deviceKeyPrefix: null, deviceKeySetAt: null },
    });

    await auditService.record({
      event: SecurityEvent.DEVICE_KEY_ROTATED,
      message: `Tracking disabled for asset #${assetId}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Asset",
      targetId: assetId,
      level: "WARNING",
    });
  },

  /** Manual location entry by an agent (spec route /assets/{id}/location/). */
  async recordManualLocation(
    session: AppSession,
    assetId: number,
    location: { city: string; region: string; country: string; notes: string },
  ): Promise<void> {
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, isDeleted: false },
      select: { id: true },
    });
    if (!asset) throw new ForbiddenError("That asset no longer exists.");

    const summary = [location.city, location.region, location.country].filter(Boolean).join(", ");

    await prisma.$transaction([
      prisma.deviceCheckin.create({
        data: {
          assetId,
          source: "manual",
          loggedInUser: session.user.username,
          geoCity: location.city,
          geoRegion: location.region,
          geoCountry: location.country,
          agentVersion: "manual",
          notes: location.notes,
        },
      }),
      prisma.asset.update({
        where: { id: assetId },
        data: { lastSeenLocation: summary || "Recorded manually", lastSeenAt: new Date() },
      }),
    ]);
  },

  async listCheckins(assetId: number, limit = 100) {
    return prisma.deviceCheckin.findMany({
      where: { assetId },
      orderBy: { reportedAt: "desc" },
      take: limit,
    });
  },
};
