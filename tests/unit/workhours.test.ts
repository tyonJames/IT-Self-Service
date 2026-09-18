import { describe, expect, it } from "vitest";
import {
  addWorkingHours,
  humaniseDuration,
  mean,
  median,
  workingHoursBetween,
  type WorkHoursConfig,
} from "@/lib/sla/workhours";
import { zonedTimeToUtc } from "@/lib/sla/timezone";

/**
 * Working-hours engine (spec §3.9, note 3).
 *
 * The defining case from the specification is asserted first: a ticket raised
 * at 16:45 on Friday with a 1-hour SLA is due at 08:45 on Monday.
 */

const TZ = "Africa/Harare";

const config: WorkHoursConfig = {
  dayStart: 8,
  dayEnd: 17,
  days: [0, 1, 2, 3, 4], // Monday–Friday, Python convention
  timeZone: TZ,
};

/** Build an instant from Harare wall-clock time. */
const at = (y: number, m: number, d: number, h: number, min = 0): Date =>
  zonedTimeToUtc(y, m, d, h, min, 0, TZ);

/** Read an instant back as Harare wall-clock, for readable assertions. */
const wall = (date: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);

describe("addWorkingHours", () => {
  it("carries a Friday 16:45 ticket with a 1-hour SLA to Monday 08:45 (spec note 3)", () => {
    // 2026-09-18 is a Friday.
    const friday = at(2026, 9, 18, 16, 45);
    const due = addWorkingHours(friday, 1, config);
    expect(wall(due)).toBe("Mon, 21/09/2026, 08:45");
  });

  it("stays inside the same day when there is room", () => {
    const monday = at(2026, 9, 21, 9, 0);
    expect(wall(addWorkingHours(monday, 3, config))).toBe("Mon, 21/09/2026, 12:00");
  });

  it("lands exactly on closing time without spilling into the next day", () => {
    const monday = at(2026, 9, 21, 14, 0);
    expect(wall(addWorkingHours(monday, 3, config))).toBe("Mon, 21/09/2026, 17:00");
  });

  it("spills the remainder into the next working day", () => {
    const monday = at(2026, 9, 21, 16, 0);
    // 1h to close, 3h remaining → Tuesday 11:00
    expect(wall(addWorkingHours(monday, 4, config))).toBe("Tue, 22/09/2026, 11:00");
  });

  it("advances a start before opening time to the opening bell first", () => {
    const monday = at(2026, 9, 21, 5, 30);
    expect(wall(addWorkingHours(monday, 2, config))).toBe("Mon, 21/09/2026, 10:00");
  });

  it("advances a start after closing time to the next morning", () => {
    const monday = at(2026, 9, 21, 20, 0);
    expect(wall(addWorkingHours(monday, 2, config))).toBe("Tue, 22/09/2026, 10:00");
  });

  it("skips the whole weekend from a Saturday start", () => {
    // 2026-09-19 is a Saturday.
    const saturday = at(2026, 9, 19, 22, 0);
    expect(wall(addWorkingHours(saturday, 2, config))).toBe("Mon, 21/09/2026, 10:00");
  });

  it("spans several working days for a long target", () => {
    const monday = at(2026, 9, 21, 9, 0);
    // 20 working hours: 8h Mon (09:00→17:00), 9h Tue, 3h Wed → Wed 11:00
    expect(wall(addWorkingHours(monday, 20, config))).toBe("Wed, 23/09/2026, 11:00");
  });

  it("handles fractional hours", () => {
    const monday = at(2026, 9, 21, 9, 0);
    expect(wall(addWorkingHours(monday, 0.5, config))).toBe("Mon, 21/09/2026, 09:30");
  });

  it("returns the start unchanged for zero or negative hours", () => {
    const monday = at(2026, 9, 21, 9, 0);
    expect(addWorkingHours(monday, 0, config).getTime()).toBe(monday.getTime());
    expect(addWorkingHours(monday, -5, config).getTime()).toBe(monday.getTime());
  });

  it("respects a different working week", () => {
    // Sunday–Thursday, 07:00–15:00.
    const middleEast: WorkHoursConfig = {
      dayStart: 7,
      dayEnd: 15,
      days: [6, 0, 1, 2, 3],
      timeZone: TZ,
    };
    // Thursday 2026-09-24 at 14:30 + 1h → Sunday 2026-09-27 07:30
    const thursday = at(2026, 9, 24, 14, 30);
    expect(wall(addWorkingHours(thursday, 1, middleEast))).toBe("Sun, 27/09/2026, 07:30");
  });
});

describe("workingHoursBetween", () => {
  it("counts only business hours within one day", () => {
    expect(workingHoursBetween(at(2026, 9, 21, 9, 0), at(2026, 9, 21, 12, 0), config)).toBe(3);
  });

  it("ignores time before opening and after closing", () => {
    // 06:00 → 20:00 on a Monday is a full 9-hour working day, not 14 hours.
    expect(workingHoursBetween(at(2026, 9, 21, 6, 0), at(2026, 9, 21, 20, 0), config)).toBe(9);
  });

  it("ignores the weekend entirely", () => {
    // Friday 16:00 → Monday 09:00: 1h Friday + 1h Monday.
    expect(workingHoursBetween(at(2026, 9, 18, 16, 0), at(2026, 9, 21, 9, 0), config)).toBe(2);
  });

  it("returns zero for a window entirely outside business hours", () => {
    expect(workingHoursBetween(at(2026, 9, 19, 9, 0), at(2026, 9, 20, 17, 0), config)).toBe(0);
  });

  it("returns zero when the end is not after the start", () => {
    const t = at(2026, 9, 21, 10, 0);
    expect(workingHoursBetween(t, t, config)).toBe(0);
    expect(workingHoursBetween(t, at(2026, 9, 21, 9, 0), config)).toBe(0);
  });

  it("is the inverse of addWorkingHours", () => {
    const start = at(2026, 9, 18, 16, 45);
    const due = addWorkingHours(start, 5, config);
    expect(workingHoursBetween(start, due, config)).toBeCloseTo(5, 6);
  });

  it("counts several full days correctly", () => {
    // Monday 08:00 → Thursday 17:00 = 4 × 9h
    expect(workingHoursBetween(at(2026, 9, 21, 8, 0), at(2026, 9, 24, 17, 0), config)).toBe(36);
  });
});

describe("humaniseDuration", () => {
  it("shows minutes under an hour", () => {
    expect(humaniseDuration(0.75, config)).toBe("45m");
  });

  it("shows hours and minutes", () => {
    expect(humaniseDuration(3.5, config)).toBe("3h 30m");
  });

  it("omits zero minutes", () => {
    expect(humaniseDuration(3, config)).toBe("3h");
  });

  it("switches to days at one working day (9 hours)", () => {
    expect(humaniseDuration(10, config)).toBe("1d 1h");
  });

  it("formats two days and an hour", () => {
    // 2 × 9h + 1h
    expect(humaniseDuration(19, config)).toBe("2d 1h");
  });

  it("omits zero hours on a whole number of days", () => {
    expect(humaniseDuration(18, config)).toBe("2d");
  });

  it("handles zero and nothing", () => {
    expect(humaniseDuration(0, config)).toBe("0m");
    expect(humaniseDuration(null, config)).toBe("—");
    expect(humaniseDuration(undefined, config)).toBe("—");
    expect(humaniseDuration(Number.NaN, config)).toBe("—");
  });
});

describe("median and mean", () => {
  it("returns the middle value of an odd-length set", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values of an even-length set", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is unmoved by one extreme outlier, unlike the mean", () => {
    const values = [1, 1, 1, 1, 1000];
    expect(median(values)).toBe(1);
    expect(mean(values)).toBe(200.8);
  });

  it("returns null for an empty set rather than zero", () => {
    // This matters: 0% compliance and "nothing to measure" are different
    // statements, and the dashboard renders them differently.
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
  });

  it("ignores non-finite values", () => {
    expect(median([1, Number.NaN, 3])).toBe(2);
  });
});
