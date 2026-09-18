import { cache } from "react";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { generateToken, sha256 } from "@/lib/security/tokens";
import { clientIp, userAgent } from "@/lib/security/request";

/**
 * DB-backed sessions (CC-001).
 *
 * The cookie holds an opaque 256-bit token; only its SHA-256 digest is stored,
 * so a database disclosure does not hand out working sessions. The cookie has
 * no Max-Age, which is what makes it die on browser close
 * (SESSION_EXPIRE_AT_BROWSER_CLOSE); the 8-hour sliding window lives on the
 * server row (SESSION_COOKIE_AGE). See CC-005.
 */

const COOKIE_BASE = "radx.session";

/** `__Host-` locks the cookie to this exact origin, path / and Secure. */
export function sessionCookieName(): string {
  return env().isProduction ? `__Host-${COOKIE_BASE}` : COOKIE_BASE;
}

/** Only slide the expiry when the session is more than this old, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  role: Role;
  isStaff: boolean;
  isSuperuser: boolean;
  /** Country code from the profile — labelled "Country" in the UI. */
  site: string;
  department: string;
  phone: string;
}

export interface AppSession {
  user: SessionUser;
  sessionId: string;
  expires: string;
}

/**
 * Effective role. A Django superuser is an admin and an `is_staff` user is at
 * least an agent, regardless of what the profile row says (spec §2).
 */
export function effectiveRole(user: {
  isSuperuser: boolean;
  isStaff: boolean;
  profileRole: Role | null | undefined;
}): Role {
  if (user.isSuperuser) return "admin";
  const declared = user.profileRole ?? "staff";
  if (declared === "admin") return "admin";
  if (user.isStaff) return "agent";
  return declared;
}

/**
 * Resolve the current session, or null.
 *
 * Memoised per request with React.cache so a page that checks permissions in
 * six places still performs one database read.
 */
export const auth = cache(async (): Promise<AppSession | null> => {
  const jar = await cookies();
  const raw = jar.get(sessionCookieName())?.value;
  if (!raw) return null;

  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: { include: { profile: true } } },
  });

  if (!row) return null;

  const now = Date.now();

  if (row.expiresAt.getTime() <= now) {
    // Expired. Delete opportunistically; the purge job sweeps the rest.
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }

  if (!row.user.isActive) {
    await prisma.session.deleteMany({ where: { userId: row.userId } }).catch(() => undefined);
    return null;
  }

  let expiresAt = row.expiresAt;

  if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    expiresAt = new Date(now + env().SESSION_COOKIE_AGE * 1000);
    await prisma.session
      .update({
        where: { id: row.id },
        data: { lastSeenAt: new Date(now), expiresAt },
      })
      .catch(() => undefined);
  }

  const { user } = row;

  return {
    sessionId: row.id,
    expires: expiresAt.toISOString(),
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim() || user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: effectiveRole({
        isSuperuser: user.isSuperuser,
        isStaff: user.isStaff,
        profileRole: user.profile?.role,
      }),
      isStaff: user.isStaff,
      isSuperuser: user.isSuperuser,
      site: user.profile?.site ?? "ZW",
      department: user.profile?.department ?? "",
      phone: user.profile?.phone ?? "",
    },
  };
});

/**
 * Issue a session after successful authentication.
 *
 * Every prior session for the user is deleted first: this is the session-key
 * cycling the spec asks for (note 9), and it also means a password reset or a
 * suspected compromise is resolved by simply logging in again.
 */
export async function createSession(userId: number): Promise<void> {
  const e = env();
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + e.SESSION_COOKIE_AGE * 1000);

  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId,
        expiresAt,
        ipAddress: await clientIp(),
        userAgent: await userAgent(),
      },
    }),
  ]);

  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: e.isProduction,
    path: "/",
    // No maxAge / expires on purpose — a session cookie dies with the browser.
    // The server-side row carries the 8-hour sliding window.
    ...(e.SESSION_EXPIRE_AT_BROWSER_CLOSE ? {} : { maxAge: e.SESSION_COOKIE_AGE }),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const name = sessionCookieName();
  const raw = jar.get(name)?.value;

  if (raw) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(raw) } }).catch(() => undefined);
  }

  jar.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env().isProduction,
    path: "/",
    maxAge: 0,
  });
}

/** Log a user out everywhere — role change, password reset, offboarding. */
export async function revokeAllForUser(userId: number): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/** Housekeeping for the scheduled job. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}
