import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

import { prisma } from "@/lib/db/prisma";
import { assetService, AssetValidationError, normaliseAssignment } from "@/services/asset.service";
import { assetRepository } from "@/repositories/asset.repository";
import { employeeService } from "@/services/employee.service";
import { deviceService, DeviceAuthError } from "@/services/device.service";
import { recycleBinService } from "@/services/recyclebin.service";
import { setStorageProvider } from "@/lib/storage";
import { LocalStorageProvider } from "@/lib/storage/local";
import { setEmailProvider, MemoryEmailProvider } from "@/lib/email";
import type { AppSession } from "@/lib/auth/session";
import { createEmployee, createSite, createUser, resetDatabase, seedLookups } from "../helpers/db";

let agent: AppSession;
let admin: AppSession;

beforeAll(() => {
  setStorageProvider(new LocalStorageProvider("./.storage-test"));
  setEmailProvider(new MemoryEmailProvider());
});

beforeEach(async () => {
  await resetDatabase();
  await seedLookups();
  agent = (await createUser({ username: "agent1", email: "agent1@radx.test", role: "agent" })).session;
  admin = (await createUser({ username: "admin1", email: "admin1@radx.test", role: "admin" })).session;
});

function assetInput(overrides: Record<string, unknown> = {}) {
  return {
    assetTag: "RDX-ZL001",
    category: "laptop" as const,
    brand: "Dell",
    model: "Latitude 5420",
    serialNumber: "7XQ4RN3",
    status: "active" as const,
    assignedEmployeeId: null,
    assignedSiteId: null,
    department: "",
    site: "ZW",
    location: "",
    macAddress: "",
    osVersion: "",
    officeVersion: "",
    laptopOrDesktop: "",
    imei1: "",
    imei2: "",
    cellNumber: "",
    package: "",
    printerType: "",
    tonerType: "",
    ipAddress: "",
    areaCode: "",
    acquisitionDate: null,
    notes: "",
    ...overrides,
  };
}

describe("asset tags", () => {
  it("stores a blank tag as NULL so many untagged assets can coexist (spec note 6)", async () => {
    const first = await assetService.create(agent, assetInput({ assetTag: null }));
    const second = await assetService.create(agent, assetInput({ assetTag: null }));

    const rows = await prisma.asset.findMany({ where: { id: { in: [first, second] } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.assetTag === null)).toBe(true);
  });

  it("refuses a duplicate tag", async () => {
    await assetService.create(agent, assetInput({ assetTag: "RDX-ZL001" }));
    await expect(assetService.create(agent, assetInput({ assetTag: "RDX-ZL001" }))).rejects.toThrow(
      AssetValidationError,
    );
  });

  it("explains that a clashing tag belongs to a deleted record", async () => {
    const id = await assetService.create(agent, assetInput({ assetTag: "RDX-ZL002" }));
    await assetService.softDelete(agent, id);

    await expect(assetService.create(agent, assetInput({ assetTag: "RDX-ZL002" }))).rejects.toThrow(
      /recycle bin/i,
    );
  });

  it("rejects an empty-string tag at the database level as well", async () => {
    // Belt and braces: the CHECK constraint stops a hand-written SQL import
    // creating two ''-tagged assets that then collide with each other.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO core_asset (asset_tag, category, status, updated_at) VALUES ('', 'laptop', 'active', now())`,
      ),
    ).rejects.toThrow();
  });
});

describe("assignment exclusivity (spec §3.4)", () => {
  it("clears the site when an employee is assigned", async () => {
    const employeeId = await createEmployee({ email: "holder@radx.test", fullName: "Tendai Moyo" });
    const siteId = await createSite("Harare Head Office");

    const id = await assetService.create(
      agent,
      assetInput({ assignedEmployeeId: employeeId, assignedSiteId: siteId }),
    );

    const row = await prisma.asset.findUniqueOrThrow({ where: { id } });
    expect(row.assignedEmployeeId).toBe(employeeId);
    expect(row.assignedSiteId).toBeNull();
    expect(row.assignedToName).toBe("Tendai Moyo");
  });

  it("syncs the holder's name from the site when only a site is given", async () => {
    const siteId = await createSite("Maputo Office", "MZ");
    const id = await assetService.create(
      agent,
      assetInput({ assignedSiteId: siteId, site: "MZ", assetTag: "RDX-MD001", category: "desktop" }),
    );

    const row = await prisma.asset.findUniqueOrThrow({ where: { id } });
    expect(row.assignedSiteId).toBe(siteId);
    expect(row.assignedEmployeeId).toBeNull();
    expect(row.assignedToName).toBe("Maputo Office");
    expect(row.location).toBe("Maputo Office");
  });

  it("is enforced by a database CHECK constraint, not only by the service", async () => {
    const employeeId = await createEmployee({ email: "x@radx.test" });
    const siteId = await createSite("Some Site");

    // Bypassing the service entirely, as a bad migration or import would.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO core_asset (category, status, assigned_employee_id, assigned_site_id, updated_at)
         VALUES ('laptop', 'active', ${employeeId}, ${siteId}, now())`,
      ),
    ).rejects.toThrow();
  });

  it("clears the holder when the assignment is removed", async () => {
    const employeeId = await createEmployee({ email: "holder@radx.test", fullName: "Tendai Moyo" });
    const id = await assetService.create(agent, assetInput({ assignedEmployeeId: employeeId }));

    await assetService.update(agent, id, assetInput({ assignedEmployeeId: null }));

    const row = await prisma.asset.findUniqueOrThrow({ where: { id } });
    expect(row.assignedEmployeeId).toBeNull();
    expect(row.assignedToName).toBe("");
  });

  it("refuses to assign to an employee that does not exist", async () => {
    await expect(
      normaliseAssignment({
        assignedEmployeeId: 9999,
        assignedSiteId: null,
        department: "",
        location: "",
        site: "ZW",
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("copies the employee's department when none is given", async () => {
    const employee = await prisma.employee.create({
      data: { fullName: "Ana Sitoe", email: "ana@radx.test", department: "Operations", site: "MZ" },
      select: { id: true },
    });

    const id = await assetService.create(
      agent,
      assetInput({ assignedEmployeeId: employee.id, department: "" }),
    );

    const row = await prisma.asset.findUniqueOrThrow({ where: { id } });
    expect(row.department).toBe("Operations");
  });
});

describe("renaming an employee", () => {
  it("keeps the denormalised holder name on their assets in step", async () => {
    const employeeId = await createEmployee({ email: "holder@radx.test", fullName: "Tendai Moyo" });
    const assetId = await assetService.create(agent, assetInput({ assignedEmployeeId: employeeId }));

    await employeeService.update(agent, employeeId, {
      fullName: "Tendai Moyo-Ncube",
      email: "holder@radx.test",
      phone: "",
      department: "",
      jobTitle: "",
      site: "ZW",
      employeeNumber: null,
      staffGroup: "staff",
      altEmail: "",
      isActive: true,
      notes: "",
      userId: null,
    });

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(row.assignedToName).toBe("Tendai Moyo-Ncube");
  });
});

describe("offboarding", () => {
  it("deactivates the person and marks their devices return-pending", async () => {
    const employeeId = await createEmployee({ email: "leaver@radx.test", fullName: "Departing Person" });
    const laptopId = await assetService.create(agent, assetInput({ assignedEmployeeId: employeeId }));
    const retiredId = await assetService.create(
      agent,
      assetInput({ assetTag: "RDX-ZL009", assignedEmployeeId: employeeId, status: "retired" }),
    );

    const result = await employeeService.offboard(agent, employeeId);

    expect(result.assetsAffected).toBe(1);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: laptopId } })).status).toBe(
      "return_pending",
    );
    // An already-retired device is left alone.
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: retiredId } })).status).toBe(
      "retired",
    );

    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(employee.isActive).toBe(false);
    expect(employee.emailPasswordEnc).toBeNull();
  });

  it("disables the linked login account and ends its sessions", async () => {
    const user = await createUser({ username: "leaver", email: "leaver@radx.test", role: "staff" });
    const employeeId = await createEmployee({ email: "leaver@radx.test", userId: user.id });

    await prisma.session.create({
      data: {
        tokenHash: "deadbeef".repeat(8),
        userId: user.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await employeeService.offboard(agent, employeeId);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("reactivates cleanly", async () => {
    const user = await createUser({ username: "back", email: "back@radx.test", role: "staff" });
    const employeeId = await createEmployee({ email: "back@radx.test", userId: user.id });

    await employeeService.offboard(agent, employeeId);
    await employeeService.reactivate(agent, employeeId);

    expect((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).isActive).toBe(
      true,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(true);
  });
});

describe("encrypted temporary password (spec §3.7)", () => {
  it("stores the password encrypted, never in plain text", async () => {
    const employeeId = await createEmployee({ email: "newstarter@radx.test" });
    await employeeService.setTemporaryPassword(agent, employeeId, "Welcome-2026!");

    const row = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(row.emailPasswordEnc).not.toBeNull();
    expect(row.emailPasswordEnc).not.toContain("Welcome-2026!");
    expect(row.emailPasswordSetAt).not.toBeNull();
  });

  it("reveals it only through the audited call", async () => {
    const employeeId = await createEmployee({ email: "newstarter@radx.test" });
    await employeeService.setTemporaryPassword(agent, employeeId, "Welcome-2026!");

    const revealed = await employeeService.revealTemporaryPassword(agent, employeeId, "203.0.113.9");
    expect(revealed.password).toBe("Welcome-2026!");

    const audit = await prisma.auditLog.findFirst({
      where: { event: "EMPLOYEE_PASSWORD_REVEALED", targetId: String(employeeId) },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorRepr).toBe("agent1");
    expect(audit!.ipAddress).toBe("203.0.113.9");
    // The password itself must never reach the audit record.
    expect(JSON.stringify(audit!.detail)).not.toContain("Welcome-2026!");
  });

  it("clears cleanly", async () => {
    const employeeId = await createEmployee({ email: "newstarter@radx.test" });
    await employeeService.setTemporaryPassword(agent, employeeId, "Welcome-2026!");
    await employeeService.clearTemporaryPassword(agent, employeeId);

    const row = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    expect(row.emailPasswordEnc).toBeNull();
    expect(row.emailPasswordSetAt).toBeNull();
  });

  it("is never included in the list projection", async () => {
    const employeeId = await createEmployee({ email: "newstarter@radx.test" });
    await employeeService.setTemporaryPassword(agent, employeeId, "Welcome-2026!");

    const { employeeRepository } = await import("@/repositories/employee.repository");
    const { rows } = await employeeRepository.list(
      {},
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );

    expect(rows).toHaveLength(1);
    expect("emailPasswordEnc" in rows[0]!).toBe(false);
    // The UI still needs to know *when* it was set, for the stale badge.
    expect(rows[0]!.emailPasswordSetAt).not.toBeNull();
  });
});

describe("device tracking (CC-004)", () => {
  it("enrols by serial number and never stores the key in recoverable form", async () => {
    const assetId = await assetService.create(agent, assetInput({ serialNumber: "SN-12345" }));

    const result = await deviceService.enrol("SN-12345", "LAPTOP-01", "203.0.113.9");
    expect(result.assetId).toBe(assetId);
    expect(result.deviceKey).toMatch(/^[0-9a-f]{64}$/);

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(row.trackingEnabled).toBe(true);
    expect(row.deviceKeyHash).not.toBeNull();
    expect(row.deviceKeyHash).not.toBe(result.deviceKey);
    expect(row.deviceKeyPrefix).toBe(result.deviceKey.slice(0, 12));
  });

  it("refuses to enrol an unknown serial number", async () => {
    await expect(deviceService.enrol("NOT-A-REAL-SERIAL", "", null)).rejects.toThrow(DeviceAuthError);
  });

  it("accepts a check-in with the issued key", async () => {
    const assetId = await assetService.create(agent, assetInput({ serialNumber: "SN-12345" }));
    const { deviceKey } = await deviceService.enrol("SN-12345", "LAPTOP-01", null);

    const authenticated = await deviceService.authenticate(deviceKey, "203.0.113.9");
    expect(authenticated).toBe(assetId);

    await deviceService.recordCheckin(assetId, {
      hostname: "LAPTOP-01",
      loggedInUser: "RADX\\tmoyo",
      wifiSsid: "Radx-HQ",
      publicIp: null,
      latitude: null,
      longitude: null,
      gpsAccuracyM: null,
      agentVersion: "1.0.0",
      notes: "",
    });

    const checkins = await prisma.deviceCheckin.findMany({ where: { assetId } });
    expect(checkins).toHaveLength(1);
    expect(checkins[0]!.wifiSsid).toBe("Radx-HQ");

    const row = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(row.lastSeenLocation).toBe("Radx-HQ");
    expect(row.lastSeenAt).not.toBeNull();
  });

  it("invalidates the previous key the moment it is rotated (spec §5.16)", async () => {
    const assetId = await assetService.create(agent, assetInput({ serialNumber: "SN-12345" }));
    const first = await deviceService.enrol("SN-12345", "LAPTOP-01", null);

    // The old key works…
    expect(await deviceService.authenticate(first.deviceKey, null)).toBe(assetId);

    const second = await deviceService.rotateKey(agent, assetId);
    expect(second).not.toBe(first.deviceKey);

    // …and immediately does not.
    await expect(deviceService.authenticate(first.deviceKey, null)).rejects.toThrow(DeviceAuthError);
    expect(await deviceService.authenticate(second, null)).toBe(assetId);
  });

  it("rejects a malformed key without touching the database", async () => {
    await expect(deviceService.authenticate("short", null)).rejects.toThrow(DeviceAuthError);
    await expect(deviceService.authenticate("z".repeat(64), null)).rejects.toThrow(DeviceAuthError);
  });

  it("stops accepting check-ins once tracking is disabled", async () => {
    const assetId = await assetService.create(agent, assetInput({ serialNumber: "SN-12345" }));
    const { deviceKey } = await deviceService.enrol("SN-12345", "LAPTOP-01", null);

    await deviceService.disableTracking(agent, assetId);

    await expect(deviceService.authenticate(deviceKey, null)).rejects.toThrow(DeviceAuthError);
  });
});

describe("asset documents", () => {
  it("stores a document under an unguessable key and removes the blob on delete", async () => {
    const assetId = await assetService.create(agent, assetInput());
    const pdf = Buffer.from("%PDF-1.7\nallocation form");
    const file = new File([new Uint8Array(pdf)], "allocation.pdf", { type: "application/pdf" });

    await assetService.addDocument(agent, assetId, file, "allocation", "Signed on handover");

    const doc = await prisma.assetDocument.findFirstOrThrow({ where: { assetId } });
    expect(doc.storageKey).toMatch(/^asset_docs\/\d+\/[0-9a-f]{32}\/allocation\.pdf$/);

    const { storage } = await import("@/lib/storage");
    expect(await storage().exists(doc.storageKey)).toBe(true);

    await assetService.deleteDocument(agent, doc.id);
    expect(await storage().exists(doc.storageKey)).toBe(false);
    expect(await prisma.assetDocument.count({ where: { assetId } })).toBe(0);
  });
});

describe("soft delete and the recycle bin", () => {
  it("hides a deleted asset, restores it, and purges it permanently", async () => {
    const assetId = await assetService.create(agent, assetInput({ assetTag: "RDX-ZL050" }));

    await assetService.softDelete(agent, assetId);
    expect(await assetRepository.findById(assetId)).toBeNull();

    const listed = await recycleBinService.list("assets", 0, 25);
    expect(listed.total).toBe(1);
    expect(listed.rows[0]!.label).toBe("RDX-ZL050");
    expect(listed.rows[0]!.deletedBy).toContain("agent1");
    expect(listed.rows[0]!.daysRemaining).toBe(30);

    await recycleBinService.restore(agent, "assets", assetId);
    expect(await assetRepository.findById(assetId)).not.toBeNull();

    await assetService.softDelete(agent, assetId);
    await recycleBinService.purge(admin, "assets", assetId);
    expect(await prisma.asset.findUnique({ where: { id: assetId } })).toBeNull();
  });

  it("keeps a deleted asset's tag reserved, so restoring can never collide", async () => {
    const first = await assetService.create(agent, assetInput({ assetTag: "RDX-ZL077" }));
    await assetService.softDelete(agent, first);

    // The unique index covers deleted rows too, so the tag is not free — and
    // the error says exactly what to do about it rather than failing opaquely.
    await expect(assetService.create(agent, assetInput({ assetTag: "RDX-ZL077" }))).rejects.toThrow(
      /recycle bin/i,
    );

    // Which means the record always restores cleanly.
    await recycleBinService.restore(agent, "assets", first);
    const restored = await assetRepository.findById(first);
    expect(restored?.assetTag).toBe("RDX-ZL077");
  });

  it("frees the tag once the deleted record is purged", async () => {
    const first = await assetService.create(agent, assetInput({ assetTag: "RDX-ZL078" }));
    await assetService.softDelete(agent, first);
    await recycleBinService.purge(admin, "assets", first);

    const second = await assetService.create(agent, assetInput({ assetTag: "RDX-ZL078" }));
    expect(second).not.toBe(first);
  });

  it("purges only records past the retention window", async () => {
    const recent = await assetService.create(agent, assetInput({ assetTag: "RDX-ZL100" }));
    const old = await assetService.create(agent, assetInput({ assetTag: "RDX-ZL101" }));

    await assetService.softDelete(agent, recent);
    await assetService.softDelete(agent, old);

    await prisma.asset.update({
      where: { id: old },
      data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) },
    });

    const result = await recycleBinService.purgeExpired();

    expect(result.assets).toBe(1);
    expect(await prisma.asset.findUnique({ where: { id: old } })).toBeNull();
    expect(await prisma.asset.findUnique({ where: { id: recent } })).not.toBeNull();
  });
});
