import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/lib/security/passwords";
import { rateLimiter } from "@/lib/security/rate-limit";
import { generateToken, sha256 } from "@/lib/security/tokens";
import { createSession, revokeAllForUser } from "@/lib/auth/session";
import { auditService } from "./audit.service";
import { notificationService } from "./notification.service";
import { passwordResetEmail } from "@/lib/email/templates";
import { SecurityEvent } from "@/lib/logging/logger";

/**
 * Authentication, lockout and password reset (spec §2).
 *
 * Two independent counters, exactly as specified: per-username (5 attempts /
 * 15 minutes) and per-IP (20 / 15 minutes). The username counter stops someone
 * grinding one account; the IP counter stops someone spraying one password
 * across many accounts.
 */

export type LoginOutcome =
  | { ok: true }
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "locked"; message: string; retryAfterSeconds: number }
  | { ok: false; reason: "disabled"; message: string };

const GENERIC_FAILURE =
  "That email address or password is not correct. Check both and try again.";

function usernameKey(identifier: string): string {
  return `login:user:${identifier.trim().toLowerCase()}`;
}

function ipKey(ip: string): string {
  return `login:ip:${ip}`;
}

export const authService = {
  /**
   * Verify credentials and, on success, issue a session.
   *
   * Failures return the same message whether the account exists or not, and a
   * password is verified even for a non-existent user (against a dummy hash)
   * so that response timing does not reveal which accounts are real.
   */
  async login(identifier: string, password: string, ip: string): Promise<LoginOutcome> {
    const e = env();
    const limiter = rateLimiter();

    const ipState = await limiter.peek(ipKey(ip), e.IP_MAX_ATTEMPTS);
    if (ipState.count >= e.IP_MAX_ATTEMPTS) {
      await auditService.record({
        event: SecurityEvent.IP_LOCKED,
        message: `Login blocked: too many failures from ${ip}`,
        ipAddress: ip,
        level: "WARNING",
      });
      return {
        ok: false,
        reason: "locked",
        message: `Too many failed sign-ins from this network. Try again in ${Math.ceil(ipState.retryAfterSeconds / 60)} minutes.`,
        retryAfterSeconds: ipState.retryAfterSeconds,
      };
    }

    const userState = await limiter.peek(usernameKey(identifier), e.LOGIN_MAX_ATTEMPTS);
    if (userState.count >= e.LOGIN_MAX_ATTEMPTS) {
      await auditService.record({
        event: SecurityEvent.ACCOUNT_LOCKED,
        message: `Login blocked: account locked after repeated failures`,
        actorRepr: identifier,
        ipAddress: ip,
        level: "WARNING",
      });
      return {
        ok: false,
        reason: "locked",
        message: `This account is temporarily locked after ${e.LOGIN_MAX_ATTEMPTS} failed attempts. Try again in ${Math.ceil(userState.retryAfterSeconds / 60)} minutes, or use “Forgot password”.`,
        retryAfterSeconds: userState.retryAfterSeconds,
      };
    }

    // Email OR username (spec §2).
    const normalised = identifier.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: normalised, mode: "insensitive" } },
          { username: { equals: normalised, mode: "insensitive" } },
        ],
      },
      include: { profile: true },
    });

    const storedHash =
      user?.passwordHash ??
      // Argon2 hash of a random string, so the comparison costs the same when
      // the account does not exist.
      "$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$3Vv8k2xY1sQmGZ5zJv2Q0bWq1KcM9Q5hN8JqQe0cRxY";

    const { valid, needsRehash } = await verifyPassword(password, storedHash);

    if (!user || !valid) {
      await limiter.hit(usernameKey(identifier), e.LOGIN_MAX_ATTEMPTS, e.LOGIN_LOCKOUT_SECONDS);
      await limiter.hit(ipKey(ip), e.IP_MAX_ATTEMPTS, e.IP_LOCKOUT_SECONDS);

      await auditService.record({
        event: SecurityEvent.LOGIN_FAILURE,
        message: "Failed sign-in attempt",
        actorRepr: identifier,
        ipAddress: ip,
        level: "WARNING",
      });

      return { ok: false, reason: "invalid", message: GENERIC_FAILURE };
    }

    if (!user.isActive) {
      await auditService.record({
        event: SecurityEvent.LOGIN_FAILURE,
        message: "Sign-in refused: account is disabled",
        actorId: user.id,
        actorRepr: user.username,
        ipAddress: ip,
        level: "WARNING",
      });
      return {
        ok: false,
        reason: "disabled",
        message: "This account has been disabled. Contact IT if you think that is wrong.",
      };
    }

    // Transparent upgrade of a hash migrated from the Django system.
    if (needsRehash) {
      await prisma.user
        .update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
        .catch(() => undefined);
    }

    await Promise.all([
      limiter.reset(usernameKey(identifier)),
      limiter.reset(ipKey(ip)),
      prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);

    // Issues a new session and deletes any previous one — session cycling
    // against fixation (spec note 9).
    await createSession(user.id);

    await auditService.record({
      event: SecurityEvent.LOGIN_SUCCESS,
      message: `${user.username} signed in`,
      actorId: user.id,
      actorRepr: user.username,
      ipAddress: ip,
    });

    return { ok: true };
  },

  /**
   * Begin a password reset.
   *
   * Always reports success to the caller: telling an anonymous visitor whether
   * an address is registered turns this form into an account-enumeration
   * oracle. Throttled per IP (spec note 14).
   */
  async requestPasswordReset(email: string, ip: string): Promise<{ throttled: boolean }> {
    const e = env();
    const limiter = rateLimiter();

    const state = await limiter.hit(
      `pwreset:ip:${ip}`,
      e.PASSWORD_RESET_MAX_PER_WINDOW,
      e.PASSWORD_RESET_WINDOW_SECONDS,
    );

    if (!state.allowed) {
      await auditService.record({
        event: SecurityEvent.RATE_LIMITED,
        message: "Password reset throttled",
        actorRepr: email,
        ipAddress: ip,
        level: "WARNING",
      });
      return { throttled: true };
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" }, isActive: true },
      select: { id: true, email: true, firstName: true, username: true },
    });

    await auditService.record({
      event: SecurityEvent.PASSWORD_RESET_REQUESTED,
      message: "Password reset requested",
      actorId: user?.id ?? null,
      actorRepr: email,
      ipAddress: ip,
    });

    if (!user) return { throttled: false };

    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + e.PASSWORD_RESET_TOKEN_TTL_SECONDS * 1000);

    await prisma.$transaction([
      // Only the newest link should work.
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      prisma.passwordResetToken.create({
        data: { tokenHash: sha256(token), userId: user.id, expiresAt, ipAddress: ip },
      }),
    ]);

    const resetUrl = `${e.APP_BASE_URL.replace(/\/+$/, "")}/accounts/password-reset/confirm/?token=${encodeURIComponent(token)}`;
    const notificationId = await notificationService.enqueue({
      kind: "password_reset",
      recipient: user.email,
      email: passwordResetEmail(
        user.firstName || user.username,
        resetUrl,
        Math.round(e.PASSWORD_RESET_TOKEN_TTL_SECONDS / 60),
      ),
    });
    void notificationService.dispatch(notificationId);

    return { throttled: false };
  },

  async validateResetToken(token: string): Promise<{ userId: number } | null> {
    if (!token) return null;
    const row = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
    return { userId: row.userId };
  },

  /**
   * Complete a reset: set the new password, burn the token, and end every
   * existing session for that user so a thief who already had one is evicted.
   */
  async completePasswordReset(
    token: string,
    newPassword: string,
    ip: string,
  ): Promise<{ ok: boolean; errors: string[] }> {
    const valid = await this.validateResetToken(token);
    if (!valid) {
      return { ok: false, errors: ["That reset link has expired or has already been used."] };
    }

    const user = await prisma.user.findUnique({
      where: { id: valid.userId },
      select: { id: true, username: true, email: true, firstName: true, lastName: true },
    });
    if (!user) return { ok: false, errors: ["That account no longer exists."] };

    const policy = validatePasswordPolicy(newPassword, {
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    if (!policy.ok) return { ok: false, errors: policy.errors };

    const hashed = await hashPassword(newPassword);

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashed } }),
      prisma.passwordResetToken.update({
        where: { tokenHash: sha256(token) },
        data: { usedAt: new Date() },
      }),
    ]);

    await revokeAllForUser(user.id);

    await auditService.record({
      event: SecurityEvent.PASSWORD_RESET,
      message: `Password reset completed for ${user.username}`,
      actorId: user.id,
      actorRepr: user.username,
      ipAddress: ip,
      level: "WARNING",
    });

    return { ok: true, errors: [] };
  },

  /** Change your own password: requires the current one. */
  async changeOwnPassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<{ ok: boolean; errors: string[] }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { ok: false, errors: ["Account not found."] };

    const { valid } = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return { ok: false, errors: ["Your current password is not correct."] };

    const policy = validatePasswordPolicy(newPassword, {
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    if (!policy.ok) return { ok: false, errors: policy.errors };

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    await auditService.record({
      event: SecurityEvent.PASSWORD_CHANGED,
      message: `${user.username} changed their password`,
      actorId: userId,
      actorRepr: user.username,
      ipAddress: ip,
    });

    return { ok: true, errors: [] };
  },
};
