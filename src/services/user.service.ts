import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, validatePasswordPolicy } from "@/lib/security/passwords";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { revokeAllForUser, type AppSession, effectiveRole } from "@/lib/auth/session";
import { assertNotSelfDemotion, ForbiddenError } from "@/lib/permissions";
import { normaliseCountryCode } from "@/lib/config/countries";

/**
 * User account management (spec §2). There is no public registration: only an
 * admin creates accounts.
 *
 * The UserProfile that the Django original created in a `post_save` signal is
 * created here explicitly, inside the same transaction as the user — a signal
 * that silently does not fire is a class of bug this design removes.
 */

export class UserValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "UserValidationError";
  }
}

export interface CreateUserInput {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  role: Role;
  site: string;
  department: string;
  phone: string;
}

export const userService = {
  async create(session: AppSession, input: CreateUserInput): Promise<number> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();

    const policy = validatePasswordPolicy(input.password, {
      username,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
    });
    if (!policy.ok) {
      throw new UserValidationError(policy.errors.join(" "), "password");
    }

    const clash = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { username: true, email: true },
    });
    if (clash) {
      throw new UserValidationError(
        clash.username === username
          ? "That username is already taken."
          : "That email address already has an account.",
        clash.username === username ? "username" : "email",
      );
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          isActive: true,
          isStaff: input.role !== "staff",
          isSuperuser: false,
        },
        select: { id: true, username: true },
      });

      await tx.userProfile.create({
        data: {
          userId: created.id,
          role: input.role,
          site: normaliseCountryCode(input.site, "ZW"),
          department: input.department,
          phone: input.phone,
        },
      });

      // Link an existing employee record with the same address, so the new
      // user immediately sees their own ticket history.
      await tx.employee.updateMany({
        where: { email: { equals: email, mode: "insensitive" }, userId: null, isDeleted: false },
        data: { userId: created.id },
      });

      return created;
    });

    await auditService.record({
      event: SecurityEvent.USER_CREATED,
      message: `User ${user.username} created with role ${input.role}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "User",
      targetId: user.id,
      detail: { role: input.role },
    });

    return user.id;
  },

  /**
   * Change a user's role. Guarded against self-demotion (spec §2) and against
   * removing the final administrator, and every existing session for that user
   * is revoked so the new permissions take effect on their next request rather
   * than whenever their session happens to expire.
   */
  async changeRole(session: AppSession, targetUserId: number, role: Role): Promise<void> {
    assertNotSelfDemotion(session, targetUserId, role);

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { profile: true },
    });
    if (!target) throw new ForbiddenError("That user no longer exists.");

    const currentRole = effectiveRole({
      isSuperuser: target.isSuperuser,
      isStaff: target.isStaff,
      profileRole: target.profile?.role,
    });

    // Defence in depth behind the self-demotion guard above: if the target is
    // the only active administrator left, demoting them would lock everyone
    // out of user management with no way back in.
    if (currentRole === "admin" && role !== "admin" && target.isActive) {
      const otherActiveAdmins = await prisma.user.count({
        where: {
          isActive: true,
          id: { not: targetUserId },
          OR: [{ isSuperuser: true }, { profile: { role: "admin" } }],
        },
      });
      if (otherActiveAdmins === 0) {
        throw new ForbiddenError(
          "This is the last active administrator account. Promote someone else before changing this one.",
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.userProfile.upsert({
        where: { userId: targetUserId },
        create: { userId: targetUserId, role },
        update: { role },
      });
      // `isSuperuser` must be cleared for ANY demotion away from admin, not
      // only down to staff: effectiveRole() treats a superuser as an admin
      // regardless of the profile row, so leaving the flag set would make the
      // demotion silently do nothing.
      await tx.user.update({
        where: { id: targetUserId },
        data: { isStaff: role !== "staff", isSuperuser: role === "admin" },
      });
    });

    await revokeAllForUser(targetUserId);

    await auditService.record({
      event: SecurityEvent.ROLE_CHANGED,
      message: `Role for ${target.username} changed ${currentRole} → ${role}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "User",
      targetId: targetUserId,
      level: "WARNING",
      detail: { from: currentRole, to: role },
    });
  },

  async setActive(session: AppSession, targetUserId: number, isActive: boolean): Promise<void> {
    if (targetUserId === session.user.id && !isActive) {
      throw new ForbiddenError("You cannot disable your own account.");
    }

    const target = await prisma.user.update({
      where: { id: targetUserId },
      data: { isActive },
      select: { username: true },
    });

    if (!isActive) await revokeAllForUser(targetUserId);

    await auditService.record({
      event: SecurityEvent.ROLE_CHANGED,
      message: `User ${target.username} ${isActive ? "enabled" : "disabled"}`,
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "User",
      targetId: targetUserId,
      level: "WARNING",
    });
  },

  async updateOwnProfile(
    session: AppSession,
    input: { firstName: string; lastName: string; department: string; phone: string; site: string },
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.user.id },
        data: { firstName: input.firstName, lastName: input.lastName },
      });
      await tx.userProfile.upsert({
        where: { userId: session.user.id },
        // Role is deliberately absent from both branches: a user editing their
        // own profile must not be able to submit a role field (mass assignment).
        create: {
          userId: session.user.id,
          role: "staff",
          department: input.department,
          phone: input.phone,
          site: normaliseCountryCode(input.site, "ZW"),
        },
        update: {
          department: input.department,
          phone: input.phone,
          site: normaliseCountryCode(input.site, "ZW"),
        },
      });
    });
  },

  async list(search: string, skip: number, take: number) {
    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { username: "asc" }],
        skip,
        take,
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
          isStaff: true,
          isSuperuser: true,
          lastLoginAt: true,
          createdAt: true,
          profile: { select: { role: true, site: true, department: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { rows, total };
  },

  /** Agents available in the "assign to" dropdown. */
  async assignableAgents() {
    return prisma.user.findMany({
      where: {
        isActive: true,
        OR: [{ isSuperuser: true }, { isStaff: true }, { profile: { role: { in: ["agent", "admin"] } } }],
      },
      orderBy: [{ firstName: "asc" }, { username: "asc" }],
      select: { id: true, username: true, firstName: true, lastName: true, email: true },
    });
  },
};
