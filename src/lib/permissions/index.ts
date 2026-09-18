import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth, type AppSession } from "@/lib/auth/session";
import { SecurityEvent, securityLog } from "@/lib/logging/logger";

/**
 * Authorisation helpers (instruction §10).
 *
 * Middleware is a coarse first gate — it knows only the URL. Real
 * authorisation happens here and is called again inside services, so a Server
 * Action reached by any route still checks.
 */

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor(message = "Please sign in to continue.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export function isAgentOrAdmin(role: Role): boolean {
  return role === "agent" || role === "admin";
}

/** Page guard: redirects to the login page, preserving where the user was going. */
export async function requireAuthenticatedUser(nextPath?: string): Promise<AppSession> {
  const session = await auth();
  if (!session) {
    const target = nextPath ? `/accounts/login/?next=${encodeURIComponent(nextPath)}` : "/accounts/login/";
    redirect(target);
  }
  return session;
}

export async function requireAgent(nextPath?: string): Promise<AppSession> {
  const session = await requireAuthenticatedUser(nextPath);
  if (!isAgentOrAdmin(session.user.role)) {
    securityLog(SecurityEvent.AUTHZ_DENIED, "Non-agent attempted an agent-only action", "WARNING", {
      userId: session.user.id,
      username: session.user.username,
      role: session.user.role,
      path: nextPath ?? "",
    });
    throw new ForbiddenError("This area is for IT agents and administrators.");
  }
  return session;
}

export async function requireAdmin(nextPath?: string): Promise<AppSession> {
  const session = await requireAuthenticatedUser(nextPath);
  if (session.user.role !== "admin") {
    securityLog(SecurityEvent.AUTHZ_DENIED, "Non-admin attempted an admin-only action", "WARNING", {
      userId: session.user.id,
      username: session.user.username,
      role: session.user.role,
      path: nextPath ?? "",
    });
    throw new ForbiddenError("This area is for administrators only.");
  }
  return session;
}

/** API guard: throws instead of redirecting, so the route handler can return 401/403 JSON. */
export async function requireApiUser(): Promise<AppSession> {
  const session = await auth();
  if (!session) throw new UnauthenticatedError();
  return session;
}

export async function requireApiAgent(): Promise<AppSession> {
  const session = await requireApiUser();
  if (!isAgentOrAdmin(session.user.role)) throw new ForbiddenError();
  return session;
}

// ---------------------------------------------------------------------------
// Object-level checks — the IDOR defence
// ---------------------------------------------------------------------------

export interface TicketOwnershipFacts {
  createdById: number | null;
  submitterEmail: string;
  employee?: { userId: number | null; email: string } | null;
}

/**
 * Staff may see a ticket they raised. "Raised" is deliberately broad, because
 * a public submission has no `createdBy`: it matches on the creator, on the
 * submitter email, or through the linked employee record.
 */
export function canViewTicket(session: AppSession, ticket: TicketOwnershipFacts): boolean {
  if (isAgentOrAdmin(session.user.role)) return true;

  const email = session.user.email.trim().toLowerCase();

  if (ticket.createdById !== null && ticket.createdById === session.user.id) return true;
  if (email && ticket.submitterEmail.trim().toLowerCase() === email) return true;
  if (ticket.employee) {
    if (ticket.employee.userId !== null && ticket.employee.userId === session.user.id) return true;
    if (email && ticket.employee.email.trim().toLowerCase() === email) return true;
  }
  return false;
}

/** Only agents and admins change a ticket. Staff can read their own, not edit them. */
export function canModifyTicket(session: AppSession): boolean {
  return isAgentOrAdmin(session.user.role);
}

/** Internal comments are invisible to staff (spec §3.11). */
export function canSeeInternalComments(session: AppSession): boolean {
  return isAgentOrAdmin(session.user.role);
}

export function assertCanViewTicket(session: AppSession, ticket: TicketOwnershipFacts): void {
  if (!canViewTicket(session, ticket)) {
    securityLog(SecurityEvent.AUTHZ_DENIED, "Ticket access denied", "WARNING", {
      userId: session.user.id,
      username: session.user.username,
    });
    throw new ForbiddenError("You do not have access to that ticket.");
  }
}

export function assertCanModifyTicket(session: AppSession): void {
  if (!canModifyTicket(session)) {
    securityLog(SecurityEvent.AUTHZ_DENIED, "Ticket modification denied", "WARNING", {
      userId: session.user.id,
      username: session.user.username,
    });
    throw new ForbiddenError("Only IT agents can change a ticket.");
  }
}

/**
 * Admin self-demotion guard (spec §2): an admin cannot strip their own admin
 * role, so the last administrator cannot lock everyone out by accident.
 */
export function assertNotSelfDemotion(session: AppSession, targetUserId: number, newRole: Role): void {
  if (targetUserId === session.user.id && newRole !== "admin") {
    throw new ForbiddenError("You cannot remove your own administrator role.");
  }
}
