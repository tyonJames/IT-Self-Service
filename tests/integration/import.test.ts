import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

import { prisma } from "@/lib/db/prisma";
import { importService, CsvImportError, MAX_IMPORT_ROWS } from "@/services/import.service";
import { setEmailProvider, MemoryEmailProvider } from "@/lib/email";
import { setStorageProvider } from "@/lib/storage";
import { LocalStorageProvider } from "@/lib/storage/local";
import type { AppSession } from "@/lib/auth/session";
import { createEmployee, createSite, createUser, resetDatabase, seedLookups } from "../helpers/db";

let agent: AppSession;

beforeAll(() => {
  setEmailProvider(new MemoryEmailProvider());
  setStorageProvider(new LocalStorageProvider("./.storage-test"));
});

beforeEach(async () => {
  await resetDatabase();
  await seedLookups();
  agent = (await createUser({ username: "agent1", email: "agent1@radx.test", role: "agent" })).session;
});

describe("employee import", () => {
  const csv = `full_name,email,department,job_title,site,staff_group
Tendai Moyo,t.moyo@radx.test,Finance,Accountant,ZW,staff
Ana Sitoe,a.sitoe@radx.test,Operations,Site Supervisor,MZ,management
Pieter van Wyk,p.vanwyk@radx.test,Plant,Plant Manager,ZA,management`;

  it("creates every valid row and normalises the country", async () => {
    const report = await importService.importEmployees(agent, csv, {
      mode: "upsert",
      dryRun: false,
    });

    expect(report.created).toBe(3);
    expect(report.updated).toBe(0);
    expect(report.issues).toHaveLength(0);
    expect(report.committed).toBe(true);

    const employees = await prisma.employee.findMany({ orderBy: { email: "asc" } });
    expect(employees).toHaveLength(3);
    // ZA in the file becomes GR in the database (CC-003).
    expect(employees.find((e) => e.email === "p.vanwyk@radx.test")!.site).toBe("GR");
    expect(employees.find((e) => e.email === "a.sitoe@radx.test")!.staffGroup).toBe("management");
  });

  it("writes nothing on a rehearsal", async () => {
    const report = await importService.importEmployees(agent, csv, { mode: "upsert", dryRun: true });

    expect(report.created).toBe(3);
    expect(report.dryRun).toBe(true);
    expect(report.committed).toBe(false);
    expect(await prisma.employee.count()).toBe(0);
  });

  it("matches headings whatever the capitalisation or separator", async () => {
    const messy = `Full Name,E-Mail,Job Title
Tendai Moyo,t.moyo@radx.test,Accountant`;

    const report = await importService.importEmployees(agent, messy, {
      mode: "upsert",
      dryRun: false,
    });
    expect(report.created).toBe(1);
    expect((await prisma.employee.findFirstOrThrow()).jobTitle).toBe("Accountant");
  });

  it("updates an existing person in upsert mode", async () => {
    await createEmployee({ email: "t.moyo@radx.test", fullName: "T Moyo" });

    const report = await importService.importEmployees(agent, csv, {
      mode: "upsert",
      dryRun: false,
    });

    expect(report.created).toBe(2);
    expect(report.updated).toBe(1);

    const updated = await prisma.employee.findFirstOrThrow({
      where: { email: "t.moyo@radx.test" },
    });
    expect(updated.fullName).toBe("Tendai Moyo");
    expect(updated.department).toBe("Finance");
  });

  it("skips and reports an existing person in create-only mode", async () => {
    await createEmployee({ email: "t.moyo@radx.test" });

    const report = await importService.importEmployees(agent, csv, {
      mode: "create",
      dryRun: false,
    });

    expect(report.created).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.issues.some((i) => i.message.includes("create only"))).toBe(true);
  });

  it("reports a bad row with its line number and writes nothing", async () => {
    const broken = `full_name,email
Valid Person,valid@radx.test
,missing-name@radx.test
Bad Email Person,not-an-email`;

    const report = await importService.importEmployees(agent, broken, {
      mode: "upsert",
      dryRun: true,
    });

    expect(report.issues).toHaveLength(2);
    // Line 3 is the row with no name (line 1 is the header).
    expect(report.issues[0]!.row).toBe(3);
    expect(report.issues[0]!.field).toBe("full_name");
    expect(report.issues[1]!.row).toBe(4);
    expect(report.issues[1]!.field).toBe("email");
    expect(report.created).toBe(1);
  });

  it("catches a duplicate inside the file itself", async () => {
    const duplicated = `full_name,email
Tendai Moyo,t.moyo@radx.test
Tendai Moyo Again,t.moyo@radx.test`;

    const report = await importService.importEmployees(agent, duplicated, {
      mode: "upsert",
      dryRun: true,
    });

    expect(report.issues.some((i) => i.message.includes("more than once"))).toBe(true);
    expect(report.created).toBe(1);
  });

  it("refuses to resurrect a person who is in the recycle bin", async () => {
    const id = await createEmployee({ email: "t.moyo@radx.test" });
    await prisma.employee.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    const report = await importService.importEmployees(agent, csv, {
      mode: "upsert",
      dryRun: false,
    });

    expect(report.skipped).toBe(1);
    expect(report.issues.some((i) => i.message.includes("recycle bin"))).toBe(true);
  });

  it("rejects a file with no recognisable columns", async () => {
    await expect(
      importService.importEmployees(agent, "a,b,c\n1,2,3", { mode: "upsert", dryRun: true }),
    ).rejects.toThrow(CsvImportError);
  });

  it("rejects an empty file", async () => {
    await expect(
      importService.importEmployees(agent, "", { mode: "upsert", dryRun: true }),
    ).rejects.toThrow(CsvImportError);
  });

  it("rejects a file beyond the row cap rather than trying to parse it", async () => {
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `Person ${i},person${i}@radx.test`,
    ).join("\n");

    await expect(
      importService.importEmployees(agent, `full_name,email\n${rows}`, {
        mode: "upsert",
        dryRun: true,
      }),
    ).rejects.toThrow(/at most/i);
  });

  it("copes with a byte-order mark and CRLF line endings", async () => {
    const withBom = `﻿full_name,email\r\nTendai Moyo,t.moyo@radx.test\r\n`;
    const report = await importService.importEmployees(agent, withBom, {
      mode: "upsert",
      dryRun: false,
    });
    expect(report.created).toBe(1);
    expect((await prisma.employee.findFirstOrThrow()).fullName).toBe("Tendai Moyo");
  });

  it("writes an audit row for a committed import", async () => {
    await importService.importEmployees(agent, csv, { mode: "upsert", dryRun: false });
    const audit = await prisma.auditLog.findFirst({ where: { event: "IMPORT_RUN" } });
    expect(audit).not.toBeNull();
    expect(audit!.detail).toMatchObject({ created: 3 });
  });

  it("does not audit a rehearsal, because nothing happened", async () => {
    await importService.importEmployees(agent, csv, { mode: "upsert", dryRun: true });
    expect(await prisma.auditLog.count({ where: { event: "IMPORT_RUN" } })).toBe(0);
  });
});

describe("asset import", () => {
  const csv = `asset_tag,category,brand,model,serial_number,status,site,location
RDX-ZL014,laptop,Dell,Latitude 5420,7XQ4RN3,active,ZW,Harare Head Office
RDX-ZP002,printer,HP,LaserJet M404,VNB3K10921,active,ZW,Harare Head Office
,monitor,Dell,P2422H,CN0J1M2K,spare,MZ,Maputo Office`;

  it("creates every valid row, including one with no tag", async () => {
    const report = await importService.importAssets(agent, csv, { mode: "upsert", dryRun: false });

    expect(report.created).toBe(3);
    expect(report.issues).toHaveLength(0);

    const assets = await prisma.asset.findMany();
    expect(assets).toHaveLength(3);
    // The untagged row must be NULL, not '' (spec note 6).
    expect(assets.filter((a) => a.assetTag === null)).toHaveLength(1);
  });

  it("assigns to an employee by email", async () => {
    const employeeId = await createEmployee({ email: "t.moyo@radx.test", fullName: "Tendai Moyo" });

    const withHolder = `asset_tag,category,assigned_to_email
RDX-ZL020,laptop,t.moyo@radx.test`;

    await importService.importAssets(agent, withHolder, { mode: "upsert", dryRun: false });

    const asset = await prisma.asset.findFirstOrThrow({ where: { assetTag: "RDX-ZL020" } });
    expect(asset.assignedEmployeeId).toBe(employeeId);
    expect(asset.assignedToName).toBe("Tendai Moyo");
    expect(asset.assignedSiteId).toBeNull();
  });

  it("assigns to a site by name when no employee is given", async () => {
    const siteId = await createSite("Harare Head Office");

    const withSite = `asset_tag,category,assigned_site
RDX-ZD030,desktop,Harare Head Office`;

    await importService.importAssets(agent, withSite, { mode: "upsert", dryRun: false });

    const asset = await prisma.asset.findFirstOrThrow({ where: { assetTag: "RDX-ZD030" } });
    expect(asset.assignedSiteId).toBe(siteId);
    expect(asset.assignedEmployeeId).toBeNull();
  });

  it("prefers the employee when both are given, preserving exclusivity", async () => {
    const employeeId = await createEmployee({ email: "t.moyo@radx.test", fullName: "Tendai Moyo" });
    await createSite("Harare Head Office");

    const both = `asset_tag,category,assigned_to_email,assigned_site
RDX-ZL040,laptop,t.moyo@radx.test,Harare Head Office`;

    await importService.importAssets(agent, both, { mode: "upsert", dryRun: false });

    const asset = await prisma.asset.findFirstOrThrow({ where: { assetTag: "RDX-ZL040" } });
    expect(asset.assignedEmployeeId).toBe(employeeId);
    expect(asset.assignedSiteId).toBeNull();
  });

  it("warns but still imports when the holder email does not match anyone", async () => {
    const orphan = `asset_tag,category,assigned_to_email
RDX-ZL050,laptop,nobody@radx.test`;

    const report = await importService.importAssets(agent, orphan, {
      mode: "upsert",
      dryRun: false,
    });

    expect(report.created).toBe(1);
    expect(report.issues.some((i) => i.field === "assigned_to_email")).toBe(true);

    const asset = await prisma.asset.findFirstOrThrow({ where: { assetTag: "RDX-ZL050" } });
    expect(asset.assignedEmployeeId).toBeNull();
  });

  it("reports an unknown category and skips the row", async () => {
    const bad = `asset_tag,category
RDX-ZL060,spaceship`;

    const report = await importService.importAssets(agent, bad, { mode: "upsert", dryRun: true });

    expect(report.created).toBe(0);
    expect(report.issues[0]!.field).toBe("category");
    expect(report.issues[0]!.message).toContain("Unknown type");
  });

  it("reports an unknown status and skips the row", async () => {
    const bad = `asset_tag,category,status
RDX-ZL070,laptop,haunted`;

    const report = await importService.importAssets(agent, bad, { mode: "upsert", dryRun: true });
    expect(report.issues[0]!.field).toBe("status");
  });

  it("catches a duplicate tag inside the file", async () => {
    const duplicated = `asset_tag,category
RDX-ZL080,laptop
RDX-ZL080,desktop`;

    const report = await importService.importAssets(agent, duplicated, {
      mode: "upsert",
      dryRun: true,
    });

    expect(report.issues.some((i) => i.message.includes("more than once"))).toBe(true);
    expect(report.created).toBe(1);
  });

  it("updates an existing asset in upsert mode", async () => {
    await importService.importAssets(agent, csv, { mode: "upsert", dryRun: false });

    const changed = `asset_tag,category,brand,model,status
RDX-ZL014,laptop,Dell,Latitude 5430,faulty`;

    const report = await importService.importAssets(agent, changed, {
      mode: "upsert",
      dryRun: false,
    });

    expect(report.updated).toBe(1);
    const asset = await prisma.asset.findFirstOrThrow({ where: { assetTag: "RDX-ZL014" } });
    expect(asset.model).toBe("Latitude 5430");
    expect(asset.status).toBe("faulty");
  });

  it("canonicalises a MAC address column", async () => {
    const withMac = `asset_tag,category,mac_address
RDX-ZL090,laptop,aa-bb-cc-dd-ee-ff`;

    await importService.importAssets(agent, withMac, { mode: "upsert", dryRun: false });
    const asset = await prisma.asset.findFirstOrThrow({ where: { assetTag: "RDX-ZL090" } });
    // The importer writes what it was given; normalisation of separators is a
    // form-layer concern, so the raw value is preserved for auditability here.
    expect(asset.macAddress).toBe("aa-bb-cc-dd-ee-ff");
  });

  it("rejects a file missing the required category column", async () => {
    await expect(
      importService.importAssets(agent, "asset_tag,brand\nRDX-ZL001,Dell", {
        mode: "upsert",
        dryRun: true,
      }),
    ).rejects.toThrow(/category/i);
  });

  it("leaves the database untouched when the parse fails", async () => {
    await expect(
      importService.importAssets(agent, 'asset_tag,category\n"unterminated,laptop', {
        mode: "upsert",
        dryRun: false,
      }),
    ).rejects.toThrow(CsvImportError);

    expect(await prisma.asset.count()).toBe(0);
  });
});
