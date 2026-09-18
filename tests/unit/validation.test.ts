import { describe, expect, it } from "vitest";
import { publicTicketSchema, ticketFilterSchema } from "@/lib/validation/tickets";
import { publicEquipmentRequestSchema, parseRequestedItems } from "@/lib/validation/equipment";
import { assetWriteSchema } from "@/lib/validation/assets";
import { employeeWriteSchema } from "@/lib/validation/employees";
import { parsePageRequest, paginate, pageWindow } from "@/lib/utils/pagination";
import { ticketReference, parseTicketReference } from "@/lib/domain/tickets";
import { daysUntilPurge, isPasswordStale, splitName, truncate } from "@/lib/utils/format";

describe("publicTicketSchema", () => {
  const valid = {
    submitterName: "Tendai Moyo",
    submitterEmail: "Tendai.Moyo@RadxConstruction.com",
    country: "ZA",
    siteName: "Harare Head Office",
    category: "hardware",
    deviceType: "laptop",
    assetNumber: "RDX-ZL014",
    anydeskId: "123 456 789",
    title: "Laptop will not connect to Wi-Fi",
    description: "It was fine yesterday.",
    sendCopy: "on",
    website: "",
  };

  it("accepts a complete submission and normalises it", () => {
    const result = publicTicketSchema.parse(valid);
    expect(result.submitterEmail).toBe("tendai.moyo@radxconstruction.com");
    // ZA is normalised to GR (CC-003).
    expect(result.country).toBe("GR");
    expect(result.sendCopy).toBe(true);
  });

  it("does not accept a priority from the public form", () => {
    // Letting anyone stamp "critical" on their own ticket would make the SLA
    // meaningless, so the field simply is not in the schema.
    const result = publicTicketSchema.parse({ ...valid, priority: "critical" });
    expect("priority" in result).toBe(false);
  });

  it("requires a name, email, title and description", () => {
    for (const field of ["submitterName", "submitterEmail", "title", "description"]) {
      const broken = { ...valid, [field]: "" };
      expect(publicTicketSchema.safeParse(broken).success, `${field} should be required`).toBe(false);
    }
  });

  it("rejects an invalid email address", () => {
    expect(publicTicketSchema.safeParse({ ...valid, submitterEmail: "not-an-email" }).success).toBe(
      false,
    );
  });

  it("rejects a filled honeypot", () => {
    expect(publicTicketSchema.safeParse({ ...valid, website: "http://spam" }).success).toBe(false);
  });

  it("collapses runaway whitespace in the title", () => {
    const result = publicTicketSchema.parse({ ...valid, title: "  too    many   spaces  " });
    expect(result.title).toBe("too many spaces");
  });

  it("keeps line breaks in the description", () => {
    const result = publicTicketSchema.parse({ ...valid, description: "line one\r\nline two" });
    expect(result.description).toBe("line one\nline two");
  });

  it("falls back to ZW for an unknown country", () => {
    expect(publicTicketSchema.parse({ ...valid, country: "XX" }).country).toBe("ZW");
  });

  it("keeps OTHER as a country", () => {
    expect(publicTicketSchema.parse({ ...valid, country: "OTHER" }).country).toBe("OTHER");
  });

  it("rejects an over-long title", () => {
    expect(publicTicketSchema.safeParse({ ...valid, title: "x".repeat(300) }).success).toBe(false);
  });
});

describe("ticketFilterSchema", () => {
  it("falls back to safe defaults rather than throwing on a hand-edited URL", () => {
    const result = ticketFilterSchema.parse({ tab: "nonsense", sort: "; DROP TABLE", dir: "sideways" });
    expect(result.tab).toBe("all");
    expect(result.sort).toBe("createdAt");
    expect(result.dir).toBe("desc");
  });

  it("accepts valid values", () => {
    const result = ticketFilterSchema.parse({ tab: "overdue", status: "open", dir: "asc" });
    expect(result.tab).toBe("overdue");
    expect(result.status).toBe("open");
    expect(result.dir).toBe("asc");
  });
});

describe("publicEquipmentRequestSchema", () => {
  const valid = {
    requesterName: "Ana Sitoe",
    requesterEmail: "a.sitoe@radxconstruction.com",
    department: "Operations",
    country: "MZ",
    siteName: "Maputo Office",
    priority: "urgent",
    otherEquipment: "",
    reason: "New starter",
    justification: "",
    sendCopy: "on",
    website: "",
  };

  it("accepts a valid request", () => {
    const result = publicEquipmentRequestSchema.parse(valid);
    expect(result.priority).toBe("urgent");
    expect(result.country).toBe("MZ");
  });

  it("defaults an unrecognised priority to normal", () => {
    expect(publicEquipmentRequestSchema.parse({ ...valid, priority: "apocalyptic" }).priority).toBe(
      "normal",
    );
  });

  it("requires a reason", () => {
    expect(publicEquipmentRequestSchema.safeParse({ ...valid, reason: "" }).success).toBe(false);
  });
});

describe("parseRequestedItems", () => {
  it("pairs each ticked item with its quantity", () => {
    const form = new FormData();
    form.append("items", "laptop");
    form.append("items", "monitor");
    form.append("quantity_laptop", "2");
    form.append("quantity_monitor", "1");

    expect(parseRequestedItems(form)).toEqual([
      { item: "laptop", quantity: 2 },
      { item: "monitor", quantity: 1 },
    ]);
  });

  it("de-duplicates a doubled checkbox", () => {
    const form = new FormData();
    form.append("items", "mouse");
    form.append("items", "mouse");
    form.append("quantity_mouse", "1");
    expect(parseRequestedItems(form)).toEqual([{ item: "mouse", quantity: 1 }]);
  });

  it("clamps a silly quantity instead of trusting it", () => {
    const form = new FormData();
    form.append("items", "laptop");
    form.append("quantity_laptop", "999999");
    expect(parseRequestedItems(form)[0]!.quantity).toBe(99);

    const negative = new FormData();
    negative.append("items", "laptop");
    negative.append("quantity_laptop", "-5");
    expect(parseRequestedItems(negative)[0]!.quantity).toBe(1);
  });

  it("defaults a missing or unparseable quantity to 1", () => {
    const form = new FormData();
    form.append("items", "laptop");
    form.append("quantity_laptop", "abc");
    expect(parseRequestedItems(form)[0]!.quantity).toBe(1);
  });
});

describe("assetWriteSchema", () => {
  const base = {
    category: "laptop",
    status: "active",
    site: "ZW",
  };

  it("turns a blank asset tag into null (spec note 6)", () => {
    expect(assetWriteSchema.parse({ ...base, assetTag: "" }).assetTag).toBeNull();
    expect(assetWriteSchema.parse({ ...base, assetTag: "   " }).assetTag).toBeNull();
  });

  it("upper-cases a supplied tag", () => {
    expect(assetWriteSchema.parse({ ...base, assetTag: "rdx-zl001" }).assetTag).toBe("RDX-ZL001");
  });

  it("canonicalises a MAC address whatever separator was typed", () => {
    expect(assetWriteSchema.parse({ ...base, macAddress: "aa-bb-cc-dd-ee-ff" }).macAddress).toBe(
      "AA:BB:CC:DD:EE:FF",
    );
    expect(assetWriteSchema.parse({ ...base, macAddress: "aabbccddeeff" }).macAddress).toBe(
      "AA:BB:CC:DD:EE:FF",
    );
  });

  it("leaves an unrecognisable MAC alone rather than mangling it", () => {
    expect(assetWriteSchema.parse({ ...base, macAddress: "not a mac" }).macAddress).toBe("not a mac");
  });

  it("refuses an asset assigned to both a person and a site (spec §3.4)", () => {
    const result = assetWriteSchema.safeParse({
      ...base,
      assignedEmployeeId: "4",
      assignedSiteId: "9",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain("not both");
    }
  });

  it("accepts either one alone", () => {
    expect(assetWriteSchema.safeParse({ ...base, assignedEmployeeId: "4" }).success).toBe(true);
    expect(assetWriteSchema.safeParse({ ...base, assignedSiteId: "9" }).success).toBe(true);
  });

  it("rejects an unknown category or status", () => {
    expect(assetWriteSchema.safeParse({ ...base, category: "spaceship" }).success).toBe(false);
    expect(assetWriteSchema.safeParse({ ...base, status: "haunted" }).success).toBe(false);
  });

  it("normalises ZA to GR", () => {
    expect(assetWriteSchema.parse({ ...base, site: "ZA" }).site).toBe("GR");
  });
});

describe("employeeWriteSchema", () => {
  const base = { fullName: "Tendai Moyo", email: "t.moyo@radxconstruction.com" };

  it("turns a blank employee number into null", () => {
    expect(employeeWriteSchema.parse({ ...base, employeeNumber: "" }).employeeNumber).toBeNull();
    expect(employeeWriteSchema.parse({ ...base, employeeNumber: "  " }).employeeNumber).toBeNull();
  });

  it("keeps a real employee number", () => {
    expect(employeeWriteSchema.parse({ ...base, employeeNumber: " E-0042 " }).employeeNumber).toBe(
      "E-0042",
    );
  });

  it("lower-cases emails", () => {
    expect(employeeWriteSchema.parse({ ...base, email: "T.Moyo@Radx.com" }).email).toBe(
      "t.moyo@radx.com",
    );
  });

  it("allows a blank alternative email but rejects a malformed one", () => {
    expect(employeeWriteSchema.parse({ ...base, altEmail: "" }).altEmail).toBe("");
    expect(employeeWriteSchema.safeParse({ ...base, altEmail: "nonsense" }).success).toBe(false);
  });

  it("defaults an unknown staff group to staff", () => {
    expect(employeeWriteSchema.parse({ ...base, staffGroup: "wizard" }).staffGroup).toBe("staff");
  });
});

describe("pagination", () => {
  it("parses sensible defaults", () => {
    const page = parsePageRequest({});
    expect(page.page).toBe(1);
    expect(page.skip).toBe(0);
    expect(page.take).toBe(25);
  });

  it("clamps a hostile page size", () => {
    expect(parsePageRequest({ pageSize: "100000" }).take).toBe(100);
    expect(parsePageRequest({ pageSize: "-5" }).take).toBe(25);
    expect(parsePageRequest({ pageSize: "abc" }).take).toBe(25);
  });

  it("clamps a negative page number", () => {
    expect(parsePageRequest({ page: "-3" }).page).toBe(1);
  });

  it("computes the window of a result set", () => {
    const result = paginate([1, 2, 3], 53, { page: 2, pageSize: 25, skip: 25, take: 25 });
    expect(result.totalPages).toBe(3);
    expect(result.from).toBe(26);
    expect(result.to).toBe(50);
    expect(result.hasPrevious).toBe(true);
    expect(result.hasNext).toBe(true);
  });

  it("reports zeroes for an empty result set", () => {
    const result = paginate([], 0, { page: 1, pageSize: 25, skip: 0, take: 25 });
    expect(result.from).toBe(0);
    expect(result.to).toBe(0);
    expect(result.totalPages).toBe(1);
  });

  it("clamps a page beyond the end", () => {
    const result = paginate([], 10, { page: 99, pageSize: 25, skip: 2450, take: 25 });
    expect(result.page).toBe(1);
  });

  it("builds a page window with ellipses", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(10, 20)).toEqual([1, "…", 8, 9, 10, 11, 12, "…", 20]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, "…", 20]);
  });
});

describe("ticket references", () => {
  it("formats as RDX-0042 (spec §3.9)", () => {
    expect(ticketReference(1)).toBe("RDX-0001");
    expect(ticketReference(42)).toBe("RDX-0042");
    expect(ticketReference(12345)).toBe("RDX-12345");
  });

  it("parses back from several shapes people actually type", () => {
    expect(parseTicketReference("RDX-0042")).toBe(42);
    expect(parseTicketReference("rdx-42")).toBe(42);
    expect(parseTicketReference("RDX 42")).toBe(42);
    expect(parseTicketReference("42")).toBe(42);
    expect(parseTicketReference(" 42 ")).toBe(42);
  });

  it("returns null for anything that is not a reference", () => {
    expect(parseTicketReference("laptop broken")).toBeNull();
    expect(parseTicketReference("")).toBeNull();
    expect(parseTicketReference("RDX-")).toBeNull();
    expect(parseTicketReference("0")).toBeNull();
  });
});

describe("formatting helpers", () => {
  it("splits a name on the first space (spec §3.7)", () => {
    expect(splitName("Tendai Moyo")).toEqual({ firstName: "Tendai", surname: "Moyo" });
    expect(splitName("Ana Maria Sitoe")).toEqual({ firstName: "Ana", surname: "Maria Sitoe" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", surname: "" });
  });

  it("counts down the days until purge (spec §3.16)", () => {
    const now = Date.now();
    expect(daysUntilPurge(new Date(now), 30)).toBe(30);
    expect(daysUntilPurge(new Date(now - 10 * 86_400_000), 30)).toBe(20);
    expect(daysUntilPurge(new Date(now - 40 * 86_400_000), 30)).toBe(0);
    expect(daysUntilPurge(null, 30)).toBe(30);
  });

  it("flags a stored password older than thirty days (spec §3.7)", () => {
    const now = Date.now();
    expect(isPasswordStale(new Date(now - 10 * 86_400_000))).toBe(false);
    expect(isPasswordStale(new Date(now - 31 * 86_400_000))).toBe(true);
    expect(isPasswordStale(null)).toBe(false);
  });

  it("truncates with an ellipsis only when needed", () => {
    expect(truncate("short", 20)).toBe("short");
    expect(truncate("a very long string indeed", 10)).toBe("a very lo…");
  });
});
