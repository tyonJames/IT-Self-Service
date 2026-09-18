import { describe, expect, it } from "vitest";
import {
  evaluateSla,
  metSla,
  overallCompliance,
  resolutionHours,
  slaComplianceByPriority,
  slaDueDate,
  SLA_TARGET_HOURS,
} from "@/lib/sla/sla";
import { zonedTimeToUtc } from "@/lib/sla/timezone";

const TZ = "Africa/Harare";
const at = (y: number, m: number, d: number, h: number, min = 0): Date =>
  zonedTimeToUtc(y, m, d, h, min, 0, TZ);

describe("SLA targets", () => {
  /**
   * These values are transcribed verbatim from the specification, where
   * `critical` is given the LONGEST target. That is inverted relative to
   * convention and is recorded as CC-002 in docs/CHANGE_CONTROL.md; the test
   * asserts what the spec says, not what convention would suggest, so that
   * changing one requires changing the other deliberately.
   */
  it("matches the specification exactly", () => {
    expect(SLA_TARGET_HOURS).toEqual({ critical: 4, high: 3, medium: 2, low: 1 });
  });
});

describe("slaDueDate", () => {
  it("applies the priority target in working hours", () => {
    const created = at(2026, 9, 21, 9, 0); // Monday
    expect(slaDueDate(created, "critical").getTime()).toBe(at(2026, 9, 21, 13, 0).getTime());
    expect(slaDueDate(created, "low").getTime()).toBe(at(2026, 9, 21, 10, 0).getTime());
  });

  it("rolls a late Friday ticket into Monday", () => {
    const created = at(2026, 9, 18, 16, 45); // Friday
    expect(slaDueDate(created, "low").getTime()).toBe(at(2026, 9, 21, 8, 45).getTime());
  });
});

describe("evaluateSla", () => {
  it("reports remaining time before the deadline", () => {
    const state = evaluateSla({
      dueDate: at(2026, 9, 21, 12, 0),
      resolvedAt: null,
      now: at(2026, 9, 21, 10, 0),
    });
    expect(state.isOverdue).toBe(false);
    expect(state.hoursRemaining).toBeCloseTo(2, 6);
    expect(state.label).toBe("2h left");
  });

  it("reports overdue time after the deadline", () => {
    const state = evaluateSla({
      dueDate: at(2026, 9, 21, 10, 0),
      resolvedAt: null,
      now: at(2026, 9, 21, 13, 0),
    });
    expect(state.isOverdue).toBe(true);
    expect(state.variant).toBe("danger");
    expect(state.label).toBe("3h overdue");
  });

  it("measures a resolved ticket against when it was resolved, not against now", () => {
    // Resolved comfortably inside the window, but "now" is a week later.
    const state = evaluateSla({
      dueDate: at(2026, 9, 21, 12, 0),
      resolvedAt: at(2026, 9, 21, 11, 0),
      now: at(2026, 9, 28, 9, 0),
    });
    expect(state.isOverdue).toBe(false);
  });

  it("warns when the deadline is imminent", () => {
    const state = evaluateSla({
      dueDate: at(2026, 9, 21, 10, 0),
      resolvedAt: null,
      now: at(2026, 9, 21, 9, 45),
    });
    expect(state.variant).toBe("warning");
  });

  it("handles a ticket with no deadline", () => {
    const state = evaluateSla({ dueDate: null, resolvedAt: null });
    expect(state.label).toBe("No SLA");
    expect(state.variant).toBe("secondary");
    expect(state.hoursRemaining).toBeNull();
  });
});

describe("resolutionHours", () => {
  it("returns null while a ticket is unresolved", () => {
    expect(resolutionHours({ createdAt: at(2026, 9, 21, 9, 0), resolvedAt: null })).toBeNull();
  });

  it("counts working hours only", () => {
    // Friday 16:00 → Monday 09:00 = 1h + 1h
    const hours = resolutionHours({
      createdAt: at(2026, 9, 18, 16, 0),
      resolvedAt: at(2026, 9, 21, 9, 0),
    });
    expect(hours).toBeCloseTo(2, 6);
  });
});

describe("metSla", () => {
  it("is null while unresolved, because nothing can be judged yet", () => {
    expect(metSla({ dueDate: at(2026, 9, 21, 12, 0), resolvedAt: null })).toBeNull();
  });

  it("is true when resolved before the deadline", () => {
    expect(
      metSla({ dueDate: at(2026, 9, 21, 12, 0), resolvedAt: at(2026, 9, 21, 11, 0) }),
    ).toBe(true);
  });

  it("is true when resolved exactly on the deadline", () => {
    const moment = at(2026, 9, 21, 12, 0);
    expect(metSla({ dueDate: moment, resolvedAt: moment })).toBe(true);
  });

  it("is false when resolved after the deadline", () => {
    expect(
      metSla({ dueDate: at(2026, 9, 21, 12, 0), resolvedAt: at(2026, 9, 21, 12, 1) }),
    ).toBe(false);
  });
});

describe("slaComplianceByPriority", () => {
  const due = at(2026, 9, 21, 12, 0);

  it("counts met and breached per priority", () => {
    const rows = slaComplianceByPriority([
      { priority: "high", dueDate: due, resolvedAt: at(2026, 9, 21, 11, 0) },
      { priority: "high", dueDate: due, resolvedAt: at(2026, 9, 21, 14, 0) },
      { priority: "low", dueDate: due, resolvedAt: at(2026, 9, 21, 9, 0) },
    ]);

    const high = rows.find((r) => r.priority === "high")!;
    expect(high.total).toBe(2);
    expect(high.met).toBe(1);
    expect(high.breached).toBe(1);
    expect(high.compliancePercent).toBe(50);

    const low = rows.find((r) => r.priority === "low")!;
    expect(low.compliancePercent).toBe(100);
  });

  it("excludes unresolved tickets from the percentage but counts them in the total", () => {
    const rows = slaComplianceByPriority([
      { priority: "medium", dueDate: due, resolvedAt: at(2026, 9, 21, 11, 0) },
      { priority: "medium", dueDate: due, resolvedAt: null },
    ]);
    const medium = rows.find((r) => r.priority === "medium")!;
    expect(medium.total).toBe(2);
    expect(medium.met).toBe(1);
    expect(medium.compliancePercent).toBe(100);
  });

  it("reports null rather than 0% when nothing is measurable", () => {
    const rows = slaComplianceByPriority([
      { priority: "critical", dueDate: due, resolvedAt: null },
    ]);
    expect(rows.find((r) => r.priority === "critical")!.compliancePercent).toBeNull();
  });

  it("always returns a row for every priority", () => {
    expect(slaComplianceByPriority([]).map((r) => r.priority)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
  });
});

describe("overallCompliance", () => {
  it("returns null when nothing has been resolved", () => {
    expect(overallCompliance([{ dueDate: at(2026, 9, 21, 12, 0), resolvedAt: null }])).toBeNull();
  });

  it("averages across every measurable ticket", () => {
    const due = at(2026, 9, 21, 12, 0);
    const value = overallCompliance([
      { dueDate: due, resolvedAt: at(2026, 9, 21, 11, 0) },
      { dueDate: due, resolvedAt: at(2026, 9, 21, 11, 30) },
      { dueDate: due, resolvedAt: at(2026, 9, 21, 13, 0) },
      { dueDate: due, resolvedAt: at(2026, 9, 21, 14, 0) },
    ]);
    expect(value).toBe(50);
  });
});
