import { describe, expect, it } from "vitest";
import type { AppSession } from "@/lib/auth/session";
import { effectiveRole } from "@/lib/auth/session";
import {
  assertCanModifyTicket,
  assertCanViewTicket,
  assertNotSelfDemotion,
  canModifyTicket,
  canSeeInternalComments,
  canViewTicket,
  ForbiddenError,
  isAgentOrAdmin,
} from "@/lib/permissions";

function session(overrides: Partial<AppSession["user"]> = {}): AppSession {
  return {
    sessionId: "s1",
    expires: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id: 10,
      username: "tendai",
      email: "tendai@radxconstruction.com",
      name: "Tendai Moyo",
      firstName: "Tendai",
      lastName: "Moyo",
      role: "staff",
      isStaff: false,
      isSuperuser: false,
      site: "ZW",
      department: "Finance",
      phone: "",
      ...overrides,
    },
  };
}

describe("effectiveRole", () => {
  it("treats a Django superuser as an admin whatever the profile says (spec §2)", () => {
    expect(effectiveRole({ isSuperuser: true, isStaff: false, profileRole: "staff" })).toBe("admin");
  });

  it("promotes an is_staff user to agent", () => {
    expect(effectiveRole({ isSuperuser: false, isStaff: true, profileRole: "staff" })).toBe("agent");
  });

  it("honours an explicit admin profile role", () => {
    expect(effectiveRole({ isSuperuser: false, isStaff: false, profileRole: "admin" })).toBe("admin");
  });

  it("defaults to staff when there is no profile", () => {
    expect(effectiveRole({ isSuperuser: false, isStaff: false, profileRole: null })).toBe("staff");
    expect(effectiveRole({ isSuperuser: false, isStaff: false, profileRole: undefined })).toBe("staff");
  });

  it("never demotes an agent profile", () => {
    expect(effectiveRole({ isSuperuser: false, isStaff: false, profileRole: "agent" })).toBe("agent");
  });
});

describe("isAgentOrAdmin", () => {
  it("covers agents and admins only", () => {
    expect(isAgentOrAdmin("agent")).toBe(true);
    expect(isAgentOrAdmin("admin")).toBe(true);
    expect(isAgentOrAdmin("staff")).toBe(false);
  });
});

describe("canViewTicket", () => {
  const ticket = {
    createdById: null,
    submitterEmail: "someone.else@radxconstruction.com",
    employee: null,
  };

  it("lets an agent see any ticket", () => {
    expect(canViewTicket(session({ role: "agent" }), ticket)).toBe(true);
  });

  it("lets an admin see any ticket", () => {
    expect(canViewTicket(session({ role: "admin" }), ticket)).toBe(true);
  });

  it("refuses a staff user someone else's ticket", () => {
    expect(canViewTicket(session(), ticket)).toBe(false);
  });

  it("lets a staff user see a ticket they created", () => {
    expect(canViewTicket(session(), { ...ticket, createdById: 10 })).toBe(true);
  });

  it("lets a staff user see a public ticket submitted under their email", () => {
    // Public submissions have no createdBy — matching on email is what links
    // them back to the person who raised them.
    expect(
      canViewTicket(session(), { ...ticket, submitterEmail: "tendai@radxconstruction.com" }),
    ).toBe(true);
  });

  it("matches the submitter email case-insensitively", () => {
    expect(
      canViewTicket(session(), { ...ticket, submitterEmail: "TENDAI@RadxConstruction.com" }),
    ).toBe(true);
  });

  it("lets a staff user see a ticket linked to their employee record", () => {
    expect(
      canViewTicket(session(), { ...ticket, employee: { userId: 10, email: "other@x.com" } }),
    ).toBe(true);
  });

  it("matches through the employee's email as well", () => {
    expect(
      canViewTicket(session(), {
        ...ticket,
        employee: { userId: null, email: "tendai@radxconstruction.com" },
      }),
    ).toBe(true);
  });

  it("does not match a different employee record", () => {
    expect(
      canViewTicket(session(), { ...ticket, employee: { userId: 99, email: "other@x.com" } }),
    ).toBe(false);
  });

  it("does not match on a blank email", () => {
    const blank = session({ email: "" });
    expect(canViewTicket(blank, { ...ticket, submitterEmail: "" })).toBe(false);
  });
});

describe("canModifyTicket", () => {
  it("is agents and admins only — staff may read their own, not edit them", () => {
    expect(canModifyTicket(session({ role: "agent" }))).toBe(true);
    expect(canModifyTicket(session({ role: "admin" }))).toBe(true);
    expect(canModifyTicket(session())).toBe(false);
  });
});

describe("canSeeInternalComments", () => {
  it("hides internal notes from staff (spec §3.11)", () => {
    expect(canSeeInternalComments(session())).toBe(false);
    expect(canSeeInternalComments(session({ role: "agent" }))).toBe(true);
  });
});

describe("assertions", () => {
  it("throws ForbiddenError when a staff user is denied a ticket", () => {
    expect(() =>
      assertCanViewTicket(session(), {
        createdById: 99,
        submitterEmail: "other@x.com",
        employee: null,
      }),
    ).toThrow(ForbiddenError);
  });

  it("does not throw when access is allowed", () => {
    expect(() =>
      assertCanViewTicket(session({ role: "agent" }), {
        createdById: 99,
        submitterEmail: "other@x.com",
        employee: null,
      }),
    ).not.toThrow();
  });

  it("throws when a staff user tries to modify", () => {
    expect(() => assertCanModifyTicket(session())).toThrow(ForbiddenError);
  });

  it("carries a 403 status", () => {
    try {
      assertCanModifyTicket(session());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ForbiddenError).status).toBe(403);
    }
  });
});

describe("assertNotSelfDemotion", () => {
  const admin = session({ id: 7, role: "admin" });

  it("blocks an admin removing their own admin role (spec §2)", () => {
    expect(() => assertNotSelfDemotion(admin, 7, "agent")).toThrow(ForbiddenError);
    expect(() => assertNotSelfDemotion(admin, 7, "staff")).toThrow(ForbiddenError);
  });

  it("allows an admin to change someone else's role", () => {
    expect(() => assertNotSelfDemotion(admin, 8, "staff")).not.toThrow();
  });

  it("allows an admin to re-save their own role as admin", () => {
    expect(() => assertNotSelfDemotion(admin, 7, "admin")).not.toThrow();
  });
});
