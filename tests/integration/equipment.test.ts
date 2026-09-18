import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

import { prisma } from "@/lib/db/prisma";
import { equipmentService } from "@/services/equipment.service";
import { equipmentRepository } from "@/repositories/equipment.repository";
import { InvalidTransitionError } from "@/lib/domain/equipment-status";
import { setEmailProvider, MemoryEmailProvider } from "@/lib/email";
import { setStorageProvider } from "@/lib/storage";
import { LocalStorageProvider } from "@/lib/storage/local";
import type { AppSession } from "@/lib/auth/session";
import { createEmployee, createSite, createUser, resetDatabase, seedLookups } from "../helpers/db";

let agent: AppSession;

beforeAll(() => {
  setEmailProvider(new MemoryEmailProvider());
  setStorageProvider(new LocalStorageProvider("./.storage-test"));
  process.env.IT_NOTIFY_EMAILS = "groupit@radxconstruction.com";
});

beforeEach(async () => {
  await resetDatabase();
  await seedLookups();
  agent = (await createUser({ username: "agent1", email: "agent1@radx.test", role: "agent" })).session;
});

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    requesterName: "Ana Sitoe",
    requesterEmail: "a.sitoe@radx.test",
    department: "Operations",
    country: "MZ",
    siteName: "Maputo Office",
    siteId: null,
    otherEquipment: "",
    reason: "New starter from 1 October",
    justification: "Replacing a laptop that died.",
    priority: "normal" as const,
    sendCopy: true,
    items: [{ item: "laptop", quantity: 1 }],
    ...overrides,
  };
}

describe("submission", () => {
  it("creates the request with its items", async () => {
    const id = await equipmentService.create(
      requestInput({
        items: [
          { item: "laptop", quantity: 1 },
          { item: "monitor", quantity: 2 },
        ],
      }),
    );

    const request = await equipmentRepository.findById(id);
    expect(request!.status).toBe("submitted");
    expect(request!.items).toHaveLength(2);
    expect(request!.items.find((i) => i.item === "monitor")!.quantity).toBe(2);
  });

  it("collapses a doubled item into a quantity rather than failing (spec §3.15)", async () => {
    const id = await equipmentService.create(
      requestInput({
        items: [
          { item: "mouse", quantity: 1 },
          { item: "mouse", quantity: 2 },
        ],
      }),
    );

    const items = await prisma.requestedItem.findMany({ where: { requestId: id } });
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(3);
  });

  it("links the requester to their employee record", async () => {
    const employeeId = await createEmployee({ email: "a.sitoe@radx.test", fullName: "Ana Sitoe" });
    const id = await equipmentService.create(requestInput());

    const request = await equipmentRepository.findById(id);
    expect(request!.employeeId).toBe(employeeId);
  });

  it("resolves a site by id and copies its name and code", async () => {
    const siteId = await createSite("Maputo Office", "MZ");
    const id = await equipmentService.create(requestInput({ siteId, siteName: "" }));

    const request = await equipmentRepository.findById(id);
    expect(request!.siteId).toBe(siteId);
    expect(request!.siteName).toBe("Maputo Office");
  });

  it("records a confirmation and an IT alert as Notification rows", async () => {
    const id = await equipmentService.create(requestInput({ sendCopy: true }));

    const notifications = await prisma.notification.findMany({ where: { kind: "equipment" } });
    expect(notifications.map((n) => n.recipient).sort()).toEqual([
      "a.sitoe@radx.test",
      "groupit@radxconstruction.com",
    ]);
    expect(notifications.every((n) => n.subject.includes(String(id)))).toBe(true);
  });

  it("normalises ZA to GR", async () => {
    const id = await equipmentService.create(requestInput({ country: "ZA" }));
    const request = await equipmentRepository.findById(id);
    expect(request!.country).toBe("GR");
  });
});

describe("the state machine (instruction §7)", () => {
  async function submitted(): Promise<number> {
    return equipmentService.create(requestInput());
  }

  it("walks the full happy path submitted → review → approved → ordered → issued", async () => {
    const id = await submitted();

    await equipmentService.applyStatus(agent, id, "review", "Checking the budget.");
    await equipmentService.applyStatus(agent, id, "approved", "Approved by the FD.");
    await equipmentService.applyStatus(agent, id, "ordered", "PO 4471 raised.");
    await equipmentService.applyStatus(agent, id, "issued", "Handed over.");

    const request = await equipmentRepository.findById(id);
    expect(request!.status).toBe("issued");
    expect(request!.issuedAt).not.toBeNull();
    expect(request!.statusHistory).toHaveLength(4);
    expect(request!.statusHistory.map((e) => e.toStatus)).toEqual([
      "review",
      "approved",
      "ordered",
      "issued",
    ]);
  });

  it("refuses to skip from submitted straight to issued", async () => {
    const id = await submitted();
    await expect(equipmentService.applyStatus(agent, id, "issued", "")).rejects.toThrow(
      InvalidTransitionError,
    );

    // Nothing should have changed.
    const request = await equipmentRepository.findById(id);
    expect(request!.status).toBe("submitted");
    expect(request!.statusHistory).toHaveLength(0);
  });

  it("treats issued as terminal", async () => {
    const id = await submitted();
    await equipmentService.applyStatus(agent, id, "approved", "");
    await equipmentService.applyStatus(agent, id, "issued", "");

    for (const target of ["review", "approved", "ordered", "hold", "declined"] as const) {
      await expect(equipmentService.applyStatus(agent, id, target, "")).rejects.toThrow(
        InvalidTransitionError,
      );
    }
  });

  it("allows a declined request to be reopened only into review", async () => {
    const id = await submitted();
    await equipmentService.applyStatus(agent, id, "declined", "Not budgeted this quarter.");

    await expect(equipmentService.applyStatus(agent, id, "approved", "")).rejects.toThrow(
      InvalidTransitionError,
    );

    await equipmentService.applyStatus(agent, id, "review", "Budget freed up.");
    expect((await equipmentRepository.findById(id))!.status).toBe("review");
  });

  it("rejects a replayed request from a stale browser tab", async () => {
    const id = await submitted();

    // Two agents act on the same page; the first wins.
    await equipmentService.applyStatus(agent, id, "approved", "Approved.");
    await expect(equipmentService.applyStatus(agent, id, "review", "")).rejects.toThrow(
      InvalidTransitionError,
    );
  });

  it("records who decided and when", async () => {
    const id = await submitted();
    await equipmentService.applyStatus(agent, id, "approved", "Fine by me.");

    const request = await equipmentRepository.findById(id);
    expect(request!.decidedById).toBe(agent.user.id);
    expect(request!.decidedAt).not.toBeNull();
    expect(request!.decisionNote).toBe("Fine by me.");
    expect(request!.statusHistory[0]!.actorRepr).toBe("agent1");
  });

  it("emails the requester on every decision", async () => {
    const id = await submitted();
    const before = await prisma.notification.count();

    await equipmentService.applyStatus(agent, id, "approved", "Approved.");

    const after = await prisma.notification.findMany({ orderBy: { id: "desc" }, take: 1 });
    expect(await prisma.notification.count()).toBe(before + 1);
    expect(after[0]!.recipient).toBe("a.sitoe@radx.test");
    expect(after[0]!.subject).toContain("approved");
  });

  it("writes an audit row for the transition", async () => {
    const id = await submitted();
    await equipmentService.applyStatus(agent, id, "hold", "Waiting on the supplier.");

    const audit = await prisma.auditLog.findFirst({
      where: { event: "EQUIPMENT_STATUS_CHANGED", targetId: String(id) },
      orderBy: { id: "desc" },
    });
    expect(audit!.detail).toMatchObject({ from: "submitted", to: "hold" });
  });
});

describe("issuing devices", () => {
  it("links the issued assets to the request", async () => {
    const assetA = await prisma.asset.create({
      data: { assetTag: "RDX-ML001", category: "laptop", site: "MZ", status: "spare" },
      select: { id: true },
    });
    const assetB = await prisma.asset.create({
      data: { assetTag: "RDX-MM001", category: "monitor", site: "MZ", status: "spare" },
      select: { id: true },
    });

    const id = await equipmentService.create(requestInput());
    await equipmentService.applyStatus(agent, id, "approved", "");
    await equipmentService.applyStatus(agent, id, "issued", "Handed over.", [assetA.id, assetB.id]);

    const request = await equipmentRepository.findById(id);
    expect(request!.issuedAssets.map((a) => a.id).sort()).toEqual([assetA.id, assetB.id].sort());
  });

  it("silently ignores an asset id that does not exist rather than failing the handover", async () => {
    const real = await prisma.asset.create({
      data: { assetTag: "RDX-ML002", category: "laptop", site: "MZ", status: "spare" },
      select: { id: true },
    });

    const id = await equipmentService.create(requestInput());
    await equipmentService.applyStatus(agent, id, "approved", "");
    await equipmentService.applyStatus(agent, id, "issued", "", [real.id, 999999]);

    const request = await equipmentRepository.findById(id);
    expect(request!.issuedAssets.map((a) => a.id)).toEqual([real.id]);
  });

  it("does not link a soft-deleted asset", async () => {
    const deleted = await prisma.asset.create({
      data: {
        assetTag: "RDX-ML003",
        category: "laptop",
        site: "MZ",
        status: "spare",
        isDeleted: true,
        deletedAt: new Date(),
      },
      select: { id: true },
    });

    const id = await equipmentService.create(requestInput());
    await equipmentService.applyStatus(agent, id, "approved", "");
    await equipmentService.applyStatus(agent, id, "issued", "", [deleted.id]);

    const request = await equipmentRepository.findById(id);
    expect(request!.issuedAssets).toHaveLength(0);
  });
});

describe("filtering", () => {
  it("separates open from closed requests", async () => {
    const open = await equipmentService.create(requestInput({ reason: "Open one" }));
    const closed = await equipmentService.create(requestInput({ reason: "Closed one" }));
    await equipmentService.applyStatus(agent, closed, "declined", "No.");

    const openList = await equipmentRepository.list(
      { openness: "open" },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );
    expect(openList.rows.map((r) => r.id)).toEqual([open]);

    const closedList = await equipmentRepository.list(
      { openness: "closed" },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );
    expect(closedList.rows.map((r) => r.id)).toEqual([closed]);
  });

  it("finds a request by its number", async () => {
    const id = await equipmentService.create(requestInput());
    const { rows } = await equipmentRepository.list(
      { openness: "all", search: `#${id}` },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );
    expect(rows.map((r) => r.id)).toEqual([id]);
  });
});

describe("the public confirmation page projection", () => {
  it("exposes only what the requester typed, never internal decisions", async () => {
    const id = await equipmentService.create(requestInput());
    await equipmentService.applyStatus(agent, id, "declined", "Budget was cut — internal note.");

    const confirmation = await equipmentRepository.findPublicConfirmation(id);

    // The id is guessable, so the projection must be narrow.
    expect(confirmation).not.toBeNull();
    expect("decisionNote" in confirmation!).toBe(false);
    expect("decidedById" in confirmation!).toBe(false);
    expect("justification" in confirmation!).toBe(false);
    expect(confirmation!.requesterName).toBe("Ana Sitoe");
  });

  it("returns nothing for a deleted request", async () => {
    const id = await equipmentService.create(requestInput());
    await equipmentService.softDelete(agent, id);
    expect(await equipmentRepository.findPublicConfirmation(id)).toBeNull();
  });
});
