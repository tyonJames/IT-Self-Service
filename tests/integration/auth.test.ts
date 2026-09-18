import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A minimal cookie jar, so the session code can set and read cookies outside a
 * real request. `createSession` writes here; the tests read it back.
 */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7", "user-agent": "vitest" }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

import { prisma } from "@/lib/db/prisma";
import { authService } from "@/services/auth.service";
import { userService } from "@/services/user.service";
import { createSession, destroySession, revokeAllForUser, sessionCookieName } from "@/lib/auth/session";
import { sha256 } from "@/lib/security/tokens";
import { resetRateLimiter } from "@/lib/security/rate-limit";
import { setEmailProvider, MemoryEmailProvider } from "@/lib/email";
import { setStorageProvider } from "@/lib/storage";
import { LocalStorageProvider } from "@/lib/storage/local";
import { ForbiddenError } from "@/lib/permissions";
import type { AppSession } from "@/lib/auth/session";
import { createUser, resetDatabase, seedLookups } from "../helpers/db";

const email = new MemoryEmailProvider();

const PASSWORD = "correct-horse-battery-staple";
let adminSession: AppSession;

beforeAll(() => {
  setEmailProvider(email);
  setStorageProvider(new LocalStorageProvider("./.storage-test"));
});

beforeEach(async () => {
  await resetDatabase();
  await seedLookups();
  jar.clear();
  email.clear();
  resetRateLimiter();

  adminSession = (
    await createUser({ username: "admin1", email: "admin1@radx.test", role: "admin" })
  ).session;
  await createUser({
    username: "tendai",
    email: "tendai@radx.test",
    role: "agent",
    password: PASSWORD,
  });
});

describe("sign in", () => {
  it("accepts a correct username and password and issues a session", async () => {
    const outcome = await authService.login("tendai", PASSWORD, "198.51.100.7");
    expect(outcome.ok).toBe(true);

    const token = jar.get(sessionCookieName());
    expect(token).toBeDefined();

    // Only the digest is stored — the cookie value must not appear in the table.
    const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token!) } });
    expect(session).not.toBeNull();
    const raw = await prisma.session.findMany();
    expect(raw.some((s) => s.tokenHash === token)).toBe(false);
  });

  it("accepts the email address instead of the username (spec §2)", async () => {
    const outcome = await authService.login("TENDAI@radx.test", PASSWORD, "198.51.100.7");
    expect(outcome.ok).toBe(true);
  });

  it("records the last sign-in time", async () => {
    await authService.login("tendai", PASSWORD, "198.51.100.7");
    const user = await prisma.user.findFirstOrThrow({ where: { username: "tendai" } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it("cycles the session on each login, so an old cookie stops working (spec note 9)", async () => {
    await authService.login("tendai", PASSWORD, "198.51.100.7");
    const firstToken = jar.get(sessionCookieName())!;

    await authService.login("tendai", PASSWORD, "198.51.100.7");
    const secondToken = jar.get(sessionCookieName())!;

    expect(secondToken).not.toBe(firstToken);
    expect(await prisma.session.count()).toBe(1);
    expect(await prisma.session.findUnique({ where: { tokenHash: sha256(firstToken) } })).toBeNull();
  });

  it("gives the same message whether or not the account exists", async () => {
    const unknown = await authService.login("nobody", "whatever-password", "198.51.100.7");
    resetRateLimiter();
    const wrongPassword = await authService.login("tendai", "wrong-password", "198.51.100.7");

    expect(unknown.ok).toBe(false);
    expect(wrongPassword.ok).toBe(false);
    if (!unknown.ok && !wrongPassword.ok) {
      // Otherwise the form becomes an account-enumeration oracle.
      expect(unknown.message).toBe(wrongPassword.message);
    }
  });

  it("refuses a disabled account with a distinct message", async () => {
    await createUser({
      username: "gone",
      email: "gone@radx.test",
      role: "agent",
      password: PASSWORD,
      isActive: false,
    });

    const outcome = await authService.login("gone", PASSWORD, "198.51.100.7");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("disabled");
  });

  it("writes an audit row for success and for failure", async () => {
    await authService.login("tendai", PASSWORD, "198.51.100.7");
    await authService.login("tendai", "wrong", "198.51.100.7");

    expect(await prisma.auditLog.count({ where: { event: "LOGIN_SUCCESS" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { event: "LOGIN_FAILURE" } })).toBe(1);
  });
});

describe("lockout (spec §2)", () => {
  it("locks the account after five failed attempts", async () => {
    for (let i = 0; i < 5; i += 1) {
      const outcome = await authService.login("tendai", "wrong", "198.51.100.7");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("invalid");
    }

    const locked = await authService.login("tendai", "wrong", "198.51.100.7");
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe("locked");
  });

  it("refuses the correct password while the account is locked", async () => {
    for (let i = 0; i < 5; i += 1) {
      await authService.login("tendai", "wrong", "198.51.100.7");
    }

    const outcome = await authService.login("tendai", PASSWORD, "198.51.100.7");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("locked");
  });

  it("clears the counter after a successful sign-in", async () => {
    for (let i = 0; i < 4; i += 1) {
      await authService.login("tendai", "wrong", "198.51.100.7");
    }

    expect((await authService.login("tendai", PASSWORD, "198.51.100.7")).ok).toBe(true);

    // Four more failures must not trip the lock, because the counter reset.
    for (let i = 0; i < 4; i += 1) {
      const outcome = await authService.login("tendai", "wrong", "198.51.100.7");
      if (!outcome.ok) expect(outcome.reason).toBe("invalid");
    }
  });

  it("locks by IP across different usernames", async () => {
    // Twenty failures from one address, spread across many accounts, so the
    // per-username counter never trips — only the per-IP one can catch this.
    for (let i = 0; i < 20; i += 1) {
      await authService.login(`victim${i}`, "wrong", "198.51.100.99");
    }

    const outcome = await authService.login("tendai", PASSWORD, "198.51.100.99");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("locked");

    // A different address is unaffected.
    expect((await authService.login("tendai", PASSWORD, "203.0.113.5")).ok).toBe(true);
  });

  it("records a lockout in the audit log", async () => {
    for (let i = 0; i < 6; i += 1) {
      await authService.login("tendai", "wrong", "198.51.100.7");
    }
    expect(await prisma.auditLog.count({ where: { event: "ACCOUNT_LOCKED" } })).toBeGreaterThan(0);
  });
});

describe("sessions", () => {
  it("clears the cookie and the row on sign out", async () => {
    await authService.login("tendai", PASSWORD, "198.51.100.7");
    expect(await prisma.session.count()).toBe(1);

    await destroySession();

    expect(jar.get(sessionCookieName())).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it("revokes every session for a user at once", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { username: "tendai" } });
    await createSession(user.id);

    await revokeAllForUser(user.id);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("password reset (spec note 14)", () => {
  it("issues a single-use token and emails a link", async () => {
    const result = await authService.requestPasswordReset("tendai@radx.test", "198.51.100.7");
    expect(result.throttled).toBe(false);

    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { kind: "password_reset" },
    });
    expect(notification.recipient).toBe("tendai@radx.test");
    // The token must reach the user by email, not be readable from the row.
    expect(notification.body).toContain("/accounts/password-reset/confirm/?token=");
  });

  it("reports success for an unknown address without creating anything", async () => {
    const result = await authService.requestPasswordReset("nobody@radx.test", "198.51.100.7");
    expect(result.throttled).toBe(false);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("invalidates any earlier unused token", async () => {
    await authService.requestPasswordReset("tendai@radx.test", "198.51.100.7");
    await authService.requestPasswordReset("tendai@radx.test", "198.51.100.7");
    expect(await prisma.passwordResetToken.count({ where: { usedAt: null } })).toBe(1);
  });

  it("throttles after five attempts from one address", async () => {
    for (let i = 0; i < 5; i += 1) {
      const result = await authService.requestPasswordReset("tendai@radx.test", "198.51.100.50");
      expect(result.throttled).toBe(false);
    }
    const sixth = await authService.requestPasswordReset("tendai@radx.test", "198.51.100.50");
    expect(sixth.throttled).toBe(true);
  });

  it("completes a reset, burns the token, and signs the user out everywhere", async () => {
    await authService.login("tendai", PASSWORD, "198.51.100.7");
    expect(await prisma.session.count()).toBe(1);

    // Recover the token from the email body, exactly as the user would.
    await authService.requestPasswordReset("tendai@radx.test", "198.51.100.7");
    const notification = await prisma.notification.findFirstOrThrow({
      where: { kind: "password_reset" },
    });
    const token = /token=([A-Za-z0-9_-]+)/.exec(notification.body)![1]!;

    const result = await authService.completePasswordReset(token, "brand-new-passphrase-2026", "198.51.100.7");
    expect(result.ok).toBe(true);

    // Old sessions are gone.
    expect(await prisma.session.count()).toBe(0);
    // The token cannot be used twice.
    const second = await authService.completePasswordReset(token, "another-passphrase-2026", "198.51.100.7");
    expect(second.ok).toBe(false);

    // The new password works and the old one does not.
    resetRateLimiter();
    expect((await authService.login("tendai", "brand-new-passphrase-2026", "198.51.100.7")).ok).toBe(true);
    resetRateLimiter();
    expect((await authService.login("tendai", PASSWORD, "198.51.100.7")).ok).toBe(false);
  });

  it("refuses a reset that fails the password policy", async () => {
    await authService.requestPasswordReset("tendai@radx.test", "198.51.100.7");
    const notification = await prisma.notification.findFirstOrThrow({
      where: { kind: "password_reset" },
    });
    const token = /token=([A-Za-z0-9_-]+)/.exec(notification.body)![1]!;

    const result = await authService.completePasswordReset(token, "short", "198.51.100.7");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/12 characters/);

    // A rejected attempt must not burn the token.
    expect(await prisma.passwordResetToken.count({ where: { usedAt: null } })).toBe(1);
  });

  it("refuses an expired token", async () => {
    await authService.requestPasswordReset("tendai@radx.test", "198.51.100.7");
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { kind: "password_reset" },
    });
    const token = /token=([A-Za-z0-9_-]+)/.exec(notification.body)![1]!;

    expect(await authService.validateResetToken(token)).toBeNull();
  });
});

describe("changing your own password", () => {
  it("requires the current password", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { username: "tendai" } });

    const wrong = await authService.changeOwnPassword(user.id, "not-it", "a-fine-new-passphrase", "1.1.1.1");
    expect(wrong.ok).toBe(false);

    const right = await authService.changeOwnPassword(user.id, PASSWORD, "a-fine-new-passphrase", "1.1.1.1");
    expect(right.ok).toBe(true);
  });
});

describe("user management", () => {
  it("creates a user with a profile in one transaction", async () => {
    const id = await userService.create(adminSession, {
      username: "newagent",
      email: "newagent@radx.test",
      firstName: "New",
      lastName: "Agent",
      password: "a-perfectly-fine-passphrase",
      role: "agent",
      site: "MZ",
      department: "IT",
      phone: "",
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { profile: true },
    });
    expect(user.profile).not.toBeNull();
    expect(user.profile!.role).toBe("agent");
    expect(user.profile!.site).toBe("MZ");
    expect(user.isStaff).toBe(true);
  });

  it("links an existing employee record with the same address", async () => {
    await prisma.employee.create({
      data: { fullName: "New Agent", email: "newagent@radx.test" },
    });

    const id = await userService.create(adminSession, {
      username: "newagent",
      email: "newagent@radx.test",
      firstName: "New",
      lastName: "Agent",
      password: "a-perfectly-fine-passphrase",
      role: "agent",
      site: "ZW",
      department: "",
      phone: "",
    });

    const employee = await prisma.employee.findFirstOrThrow({
      where: { email: "newagent@radx.test" },
    });
    expect(employee.userId).toBe(id);
  });

  it("refuses a duplicate username or email", async () => {
    await expect(
      userService.create(adminSession, {
        username: "tendai",
        email: "different@radx.test",
        firstName: "",
        lastName: "",
        password: "a-perfectly-fine-passphrase",
        role: "agent",
        site: "ZW",
        department: "",
        phone: "",
      }),
    ).rejects.toThrow(/username is already taken/i);
  });

  it("refuses a password that fails the policy", async () => {
    await expect(
      userService.create(adminSession, {
        username: "weak",
        email: "weak@radx.test",
        firstName: "",
        lastName: "",
        password: "short",
        role: "agent",
        site: "ZW",
        department: "",
        phone: "",
      }),
    ).rejects.toThrow(/at least 12 characters/i);
  });

  it("blocks an admin from demoting themselves (spec §2)", async () => {
    await expect(
      userService.changeRole(adminSession, adminSession.user.id, "agent"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows demoting a second administrator while another remains", async () => {
    const other = await createUser({ username: "admin2", email: "admin2@radx.test", role: "admin" });

    await userService.changeRole(adminSession, other.id, "agent");

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: other.id } });
    expect(profile.role).toBe("agent");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).isSuperuser).toBe(false);
  });

  it("blocks demoting the only active administrator left", async () => {
    // Two admins, but the one doing the demoting has since been disabled —
    // the target is then the last administrator anyone could sign in as.
    const other = await createUser({ username: "admin2", email: "admin2@radx.test", role: "admin" });
    await prisma.user.update({ where: { id: other.id }, data: { isActive: false } });

    await expect(
      userService.changeRole(other.session, adminSession.user.id, "staff"),
    ).rejects.toThrow(/last active administrator/i);

    // The role is untouched.
    const profile = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: adminSession.user.id },
    });
    expect(profile.role).toBe("admin");
  });

  it("signs a user out when their role changes, so it takes effect at once", async () => {
    const target = await createUser({ username: "target", email: "target@radx.test", role: "staff" });
    await createSession(target.id);
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(1);

    await userService.changeRole(adminSession, target.id, "agent");

    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { event: "ROLE_CHANGED" } });
    expect(audit!.detail).toMatchObject({ from: "staff", to: "agent" });
  });

  it("blocks an admin from disabling their own account", async () => {
    await expect(userService.setActive(adminSession, adminSession.user.id, false)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("does not let a profile update change the role (mass assignment)", async () => {
    const target = await createUser({ username: "target", email: "target@radx.test", role: "staff" });

    await userService.updateOwnProfile(target.session, {
      firstName: "Target",
      lastName: "Person",
      department: "Finance",
      phone: "",
      site: "MZ",
    });

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: target.id } });
    expect(profile.role).toBe("staff");
    expect(profile.department).toBe("Finance");
    expect(profile.site).toBe("MZ");
  });
});
