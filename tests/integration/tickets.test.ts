import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Server code reads the caller's IP and user-agent from next/headers, which
// only exists inside a request. A minimal stub keeps the services testable
// without standing up a server.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

import { prisma } from "@/lib/db/prisma";
import { ticketService } from "@/services/ticket.service";
import { ticketRepository } from "@/repositories/ticket.repository";
import { slaDueDate } from "@/lib/sla/sla";
import { ticketReference } from "@/lib/domain/tickets";
import { canViewTicket } from "@/lib/permissions";
import { MemoryEmailProvider, setEmailProvider } from "@/lib/email";
import { setStorageProvider } from "@/lib/storage";
import { LocalStorageProvider } from "@/lib/storage/local";
import type { AppSession } from "@/lib/auth/session";
import {
  createEmployee,
  createUser,
  resetDatabase,
  seedLookups,
} from "../helpers/db";

const email = new MemoryEmailProvider();

let agent: AppSession;
let staff: AppSession;
let staffUserId: number;

beforeAll(() => {
  setEmailProvider(email);
  setStorageProvider(new LocalStorageProvider("./.storage-test"));
  process.env.IT_NOTIFY_EMAILS = "groupit@radxconstruction.com";
});

beforeEach(async () => {
  await resetDatabase();
  await seedLookups();
  email.clear();

  agent = (await createUser({ username: "agent1", email: "agent1@radx.test", role: "agent" })).session;
  const staffUser = await createUser({
    username: "staff1",
    email: "staff1@radx.test",
    role: "staff",
  });
  staff = staffUser.session;
  staffUserId = staffUser.id;
});

function publicTicketInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Laptop will not connect to Wi-Fi",
    description: "It worked yesterday.",
    category: "hardware",
    deviceType: "laptop",
    anydeskId: "",
    country: "ZW",
    siteName: "Harare Head Office",
    assetNumber: "",
    submitterName: "Tendai Moyo",
    submitterEmail: "t.moyo@radx.test",
    sendCopy: true,
    submittedPublicly: true,
    createdById: null,
    ...overrides,
  };
}

describe("ticket creation", () => {
  it("creates a ticket with a sequential reference and an SLA deadline", async () => {
    const created = await ticketService.create(publicTicketInput());

    expect(created.id).toBe(1);
    expect(created.reference).toBe("RDX-0001");
    expect(created.dueDate).not.toBeNull();

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("open");
    expect(row.priority).toBe("medium"); // public submissions never set their own priority
    expect(row.submittedPublicly).toBe(true);
    expect(row.createdById).toBeNull();
    expect(row.dueDate!.getTime()).toBe(slaDueDate(row.createdAt, "medium").getTime());
  });

  it("issues references without gaps or collisions under concurrency", async () => {
    // Ten simultaneous submissions — the sequence, not application code, is
    // what guarantees uniqueness (spec §3.9).
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        ticketService.create(publicTicketInput({ title: `Concurrent ticket ${i}` })),
      ),
    );

    const references = results.map((r) => r.reference);
    expect(new Set(references).size).toBe(10);
    expect(new Set(results.map((r) => r.id)).size).toBe(10);

    const all = await prisma.ticket.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    expect(all.map((t) => ticketReference(t.id))).toEqual(
      Array.from({ length: 10 }, (_, i) => ticketReference(i + 1)),
    );
  });

  it("normalises ZA to GR on the way in (CC-003)", async () => {
    const created = await ticketService.create(publicTicketInput({ country: "ZA" }));
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.country).toBe("GR");
    expect(row.site).toBe("GR");
  });

  it("links the ticket to an employee whose email matches", async () => {
    const employeeId = await createEmployee({ email: "t.moyo@radx.test", fullName: "Tendai Moyo" });
    const created = await ticketService.create(publicTicketInput());

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.employeeId).toBe(employeeId);
  });

  it("matches on an employee's alternative email too", async () => {
    const employee = await prisma.employee.create({
      data: { fullName: "Tendai Moyo", email: "tendai@radx.test", altEmail: "t.moyo@radx.test" },
      select: { id: true },
    });
    const created = await ticketService.create(publicTicketInput());
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.employeeId).toBe(employee.id);
  });

  it("leaves employeeId null when nothing matches", async () => {
    const created = await ticketService.create(publicTicketInput());
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.employeeId).toBeNull();
  });

  it("records a Notification row for every email it intends to send", async () => {
    const created = await ticketService.create(publicTicketInput({ sendCopy: true }));

    const notifications = await prisma.notification.findMany({ where: { ticketId: created.id } });
    // One confirmation to the reporter, one alert to IT.
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.recipient).sort()).toEqual([
      "groupit@radxconstruction.com",
      "t.moyo@radx.test",
    ]);
    expect(notifications.every((n) => n.kind === "submitted")).toBe(true);
  });

  it("does not email the reporter when they did not ask for a copy", async () => {
    const created = await ticketService.create(publicTicketInput({ sendCopy: false }));
    const notifications = await prisma.notification.findMany({ where: { ticketId: created.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.recipient).toBe("groupit@radxconstruction.com");
  });

  it("stores attachments and links them to the ticket", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const file = new File([new Uint8Array(png)], "screenshot.png", { type: "image/png" });

    const created = await ticketService.create(publicTicketInput(), [file]);

    const attachments = await prisma.ticketAttachment.findMany({ where: { ticketId: created.id } });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename).toBe("screenshot.png");
    // The storage key must not be guessable from the ticket id alone.
    expect(attachments[0]!.storageKey).toMatch(/^tickets\/\d+\/[0-9a-f]{32}\/screenshot\.png$/);
  });

  it("rejects a disallowed attachment without creating the ticket", async () => {
    const file = new File([new Uint8Array(Buffer.from("MZ..."))], "payload.exe", {
      type: "application/octet-stream",
    });

    await expect(ticketService.create(publicTicketInput(), [file])).rejects.toThrow(
      /not an accepted file type/i,
    );

    // Nothing should have been written — validation happens before the write.
    expect(await prisma.ticket.count()).toBe(0);
  });
});

describe("status changes", () => {
  it("stamps resolvedAt when a ticket is resolved and clears it when reopened", async () => {
    const created = await ticketService.create(publicTicketInput());

    await ticketService.changeStatus(agent, created.id, "resolved", "Replaced the Wi-Fi driver.");
    let row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("resolved");
    expect(row.resolvedAt).not.toBeNull();

    await ticketService.changeStatus(agent, created.id, "open", "Reporter says it is back.");
    row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("open");
    // Otherwise the ticket would count as resolved in the statistics forever.
    expect(row.resolvedAt).toBeNull();
  });

  it("keeps the original resolution time when moving from resolved to closed", async () => {
    const created = await ticketService.create(publicTicketInput());
    await ticketService.changeStatus(agent, created.id, "resolved", "");
    const first = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });

    await ticketService.changeStatus(agent, created.id, "closed", "");
    const second = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });

    expect(second.resolvedAt!.getTime()).toBe(first.resolvedAt!.getTime());
  });

  it("adds the note as a public comment and emails the reporter", async () => {
    const created = await ticketService.create(publicTicketInput());
    await ticketService.changeStatus(agent, created.id, "in_progress", "On my way to your desk.");

    const comments = await prisma.comment.findMany({ where: { ticketId: created.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.isInternal).toBe(false);
    expect(comments[0]!.body).toBe("On my way to your desk.");

    const updates = await prisma.notification.findMany({
      where: { ticketId: created.id, kind: "update" },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.recipient).toBe("t.moyo@radx.test");
  });

  it("writes an audit row for the change", async () => {
    const created = await ticketService.create(publicTicketInput());
    await ticketService.changeStatus(agent, created.id, "waiting", "");

    const audit = await prisma.auditLog.findFirst({
      where: { event: "TICKET_STATUS_CHANGED", targetId: String(created.id) },
      orderBy: { id: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorRepr).toBe("agent1");
  });
});

describe("priority changes", () => {
  it("recalculates the SLA deadline from the original creation time, not from now", async () => {
    const created = await ticketService.create(publicTicketInput());
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });

    await ticketService.update(agent, created.id, { priority: "critical" });

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.priority).toBe("critical");
    expect(after.dueDate!.getTime()).toBe(slaDueDate(before.createdAt, "critical").getTime());
    expect(after.dueDate!.getTime()).not.toBe(before.dueDate!.getTime());
  });

  it("leaves the deadline alone when the priority does not change", async () => {
    const created = await ticketService.create(publicTicketInput());
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });

    await ticketService.update(agent, created.id, { category: "network" });

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.dueDate!.getTime()).toBe(before.dueDate!.getTime());
    expect(after.category).toBe("network");
  });
});

describe("assignment", () => {
  it("assigns a ticket and notifies the agent", async () => {
    const created = await ticketService.create(publicTicketInput());
    await ticketService.assign(agent, created.id, agent.user.id);

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.assignedToId).toBe(agent.user.id);

    const assigned = await prisma.notification.findMany({
      where: { ticketId: created.id, kind: "assigned" },
    });
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.recipient).toBe("agent1@radx.test");
  });

  it("unassigns without notifying anyone", async () => {
    const created = await ticketService.create(publicTicketInput());
    await ticketService.assign(agent, created.id, agent.user.id);
    await ticketService.assign(agent, created.id, null);

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.assignedToId).toBeNull();
    expect(
      await prisma.notification.count({ where: { ticketId: created.id, kind: "assigned" } }),
    ).toBe(1);
  });

  it("refuses to assign to a disabled account", async () => {
    const disabled = await createUser({
      username: "gone",
      email: "gone@radx.test",
      role: "agent",
      isActive: false,
    });
    const created = await ticketService.create(publicTicketInput());

    await expect(ticketService.assign(agent, created.id, disabled.id)).rejects.toThrow(
      /cannot be assigned/i,
    );
  });
});

describe("comments and visibility", () => {
  it("hides internal notes from a staff user but shows them to an agent", async () => {
    const created = await ticketService.create(
      publicTicketInput({ submitterEmail: staff.user.email }),
    );

    await ticketService.addComment(agent, created.id, "Public update for the reporter.", false);
    await ticketService.addComment(agent, created.id, "Internal: probably the docking station.", true);

    const ticket = await ticketRepository.findById(created.id);
    const all = ticket!.comments;
    expect(all).toHaveLength(2);

    // The page filters by this exact rule.
    const visibleToStaff = all.filter((c) => !c.isInternal);
    expect(visibleToStaff).toHaveLength(1);
    expect(visibleToStaff[0]!.body).toBe("Public update for the reporter.");
  });

  it("does not email anyone for an internal note", async () => {
    const created = await ticketService.create(publicTicketInput());
    const before = await prisma.notification.count({ where: { ticketId: created.id } });

    await ticketService.addComment(agent, created.id, "Internal only.", true);

    expect(await prisma.notification.count({ where: { ticketId: created.id } })).toBe(before);
  });

  it("emails the reporter when an agent replies publicly", async () => {
    const created = await ticketService.create(publicTicketInput());
    await ticketService.addComment(agent, created.id, "We have ordered the part.", false);

    const replies = await prisma.notification.findMany({
      where: { ticketId: created.id, kind: "reply" },
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]!.recipient).toBe("t.moyo@radx.test");
  });

  it("alerts IT when the reporter replies", async () => {
    const created = await ticketService.create(
      publicTicketInput({ submitterEmail: staff.user.email }),
    );
    await ticketService.addComment(staff, created.id, "It is happening again.", false);

    const replies = await prisma.notification.findMany({
      where: { ticketId: created.id, kind: "reply" },
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]!.recipient).toBe("groupit@radxconstruction.com");
  });
});

describe("staff visibility scoping", () => {
  it("returns only the staff user's own tickets from the list query", async () => {
    await ticketService.create(publicTicketInput({ submitterEmail: staff.user.email }));
    await ticketService.create(publicTicketInput({ submitterEmail: "someone.else@radx.test" }));
    await ticketService.create(publicTicketInput({ createdById: staffUserId, sendCopy: false }));

    const { rows, total } = await ticketRepository.list(
      { visibleToUser: { userId: staffUserId, email: staff.user.email } },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );

    expect(total).toBe(2);
    expect(rows).toHaveLength(2);
  });

  it("returns everything for an agent", async () => {
    await ticketService.create(publicTicketInput({ submitterEmail: staff.user.email }));
    await ticketService.create(publicTicketInput({ submitterEmail: "someone.else@radx.test" }));

    const { total } = await ticketRepository.list(
      { visibleToUser: null },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );
    expect(total).toBe(2);
  });

  it("agrees with canViewTicket for the same records", async () => {
    const mine = await ticketService.create(
      publicTicketInput({ submitterEmail: staff.user.email }),
    );
    const theirs = await ticketService.create(
      publicTicketInput({ submitterEmail: "someone.else@radx.test" }),
    );

    const mineFacts = await ticketRepository.findOwnershipFacts(mine.id);
    const theirsFacts = await ticketRepository.findOwnershipFacts(theirs.id);

    expect(canViewTicket(staff, mineFacts!)).toBe(true);
    expect(canViewTicket(staff, theirsFacts!)).toBe(false);
    expect(canViewTicket(agent, theirsFacts!)).toBe(true);
  });
});

describe("soft delete", () => {
  it("hides a deleted ticket from every normal query but keeps the row", async () => {
    const created = await ticketService.create(publicTicketInput());
    await ticketService.softDelete(agent, created.id);

    expect(await ticketRepository.findById(created.id)).toBeNull();

    const { total } = await ticketRepository.list(
      {},
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );
    expect(total).toBe(0);

    // The row is still there, flagged.
    const raw = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(raw.isDeleted).toBe(true);
    expect(raw.deletedAt).not.toBeNull();
    expect(raw.deletedById).toBe(agent.user.id);
  });
});

describe("overdue filtering", () => {
  it("finds tickets past their deadline that are not resolved or closed", async () => {
    const overdue = await ticketService.create(publicTicketInput({ title: "Overdue one" }));
    const fine = await ticketService.create(publicTicketInput({ title: "Still in time" }));
    const resolvedLate = await ticketService.create(publicTicketInput({ title: "Resolved late" }));

    const past = new Date(Date.now() - 86_400_000);
    await prisma.ticket.update({ where: { id: overdue.id }, data: { dueDate: past } });
    await prisma.ticket.update({
      where: { id: resolvedLate.id },
      data: { dueDate: past, status: "resolved", resolvedAt: new Date() },
    });

    const { rows } = await ticketRepository.list(
      { overdueOnly: true },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );

    expect(rows.map((r) => r.id)).toEqual([overdue.id]);
    expect(rows.map((r) => r.id)).not.toContain(fine.id);
    expect(rows.map((r) => r.id)).not.toContain(resolvedLate.id);
  });
});

describe("search", () => {
  it("finds a ticket by its reference number", async () => {
    await ticketService.create(publicTicketInput({ title: "First" }));
    const second = await ticketService.create(publicTicketInput({ title: "Second" }));

    const { rows } = await ticketRepository.list(
      { search: second.reference },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );
    expect(rows.map((r) => r.id)).toEqual([second.id]);
  });

  it("finds a ticket by words in its title, case-insensitively", async () => {
    await ticketService.create(publicTicketInput({ title: "Printer jamming in Accounts" }));
    await ticketService.create(publicTicketInput({ title: "Wi-Fi keeps dropping" }));

    const { rows } = await ticketRepository.list(
      { search: "PRINTER" },
      { page: 1, pageSize: 25, skip: 0, take: 25 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toContain("Printer");
  });
});
