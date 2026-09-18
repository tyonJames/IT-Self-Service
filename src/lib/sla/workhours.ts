import { env } from "@/lib/config/env";
import {
  startOfZonedDayPlus,
  zonedHourOnSameDay,
  zonedParts,
} from "./timezone";

/**
 * Working-hours engine — the Next.js equivalent of the Django `workhours`
 * module (spec §3.9).
 *
 * Business hours are Monday–Friday 08:00–17:00 in Africa/Harare by default,
 * all four values configurable. WORK_DAYS follows the Python convention the
 * spec's env var uses: Monday = 0 … Sunday = 6.
 *
 * The defining example from spec note 3: a ticket raised at 16:45 on Friday
 * with a 1-hour SLA is due at 08:45 on Monday. `tests/unit/workhours.test.ts`
 * asserts exactly that.
 */

export interface WorkHoursConfig {
  dayStart: number;
  dayEnd: number;
  /** Python weekdays (Mon = 0). */
  days: number[];
  timeZone: string;
}

export function workHoursConfig(): WorkHoursConfig {
  const e = env();
  return {
    dayStart: e.WORK_DAY_START,
    dayEnd: e.WORK_DAY_END,
    days: e.workDays,
    timeZone: e.WORK_TIMEZONE,
  };
}

const MS_PER_HOUR = 3_600_000;
/** A working day's length in hours — used by humaniseDuration for "2d 1h". */
export function hoursPerWorkingDay(config: WorkHoursConfig = workHoursConfig()): number {
  return Math.max(1, config.dayEnd - config.dayStart);
}

function isWorkingDay(date: Date, config: WorkHoursConfig): boolean {
  return config.days.includes(zonedParts(date, config.timeZone).weekday);
}

/** The [open, close) window for the calendar day containing `date`. */
function windowFor(date: Date, config: WorkHoursConfig): { open: Date; close: Date } {
  return {
    open: zonedHourOnSameDay(date, config.dayStart, config.timeZone),
    close: zonedHourOnSameDay(date, config.dayEnd, config.timeZone),
  };
}

/**
 * Walk forward from `start` by `hours` of working time.
 *
 * A start outside business hours is first advanced to the next opening bell,
 * so a ticket raised at 22:00 on Saturday with a 2-hour SLA is due at 10:00 on
 * Monday, not at 02:00 on Sunday.
 */
export function addWorkingHours(
  start: Date,
  hours: number,
  config: WorkHoursConfig = workHoursConfig(),
): Date {
  if (!Number.isFinite(hours) || hours <= 0) return new Date(start.getTime());

  let cursor = new Date(start.getTime());
  let remainingMs = hours * MS_PER_HOUR;

  // 3650 iterations ≈ 10 years of calendar days: enough for any real SLA, and
  // a hard stop so a pathological config can never spin forever.
  for (let guard = 0; guard < 3650; guard += 1) {
    if (!isWorkingDay(cursor, config)) {
      cursor = startOfZonedDayPlus(cursor, 1, config.timeZone);
      continue;
    }

    const { open, close } = windowFor(cursor, config);

    if (cursor.getTime() < open.getTime()) {
      cursor = open;
    }
    if (cursor.getTime() >= close.getTime()) {
      cursor = startOfZonedDayPlus(cursor, 1, config.timeZone);
      continue;
    }

    const availableMs = close.getTime() - cursor.getTime();
    if (remainingMs <= availableMs) {
      return new Date(cursor.getTime() + remainingMs);
    }

    remainingMs -= availableMs;
    cursor = startOfZonedDayPlus(cursor, 1, config.timeZone);
  }

  // Unreachable with any sane configuration; returning the cursor beats throwing
  // inside a ticket save.
  return cursor;
}

/**
 * Count working hours between two instants. Time outside business hours,
 * at weekends, or before `start` / after `end` does not count.
 */
export function workingHoursBetween(
  start: Date,
  end: Date,
  config: WorkHoursConfig = workHoursConfig(),
): number {
  if (end.getTime() <= start.getTime()) return 0;

  let totalMs = 0;
  let cursor = new Date(start.getTime());

  for (let guard = 0; guard < 3650; guard += 1) {
    if (cursor.getTime() >= end.getTime()) break;

    if (!isWorkingDay(cursor, config)) {
      cursor = startOfZonedDayPlus(cursor, 1, config.timeZone);
      continue;
    }

    const { open, close } = windowFor(cursor, config);
    const segmentStart = Math.max(cursor.getTime(), open.getTime());
    const segmentEnd = Math.min(end.getTime(), close.getTime());

    if (segmentEnd > segmentStart) {
      totalMs += segmentEnd - segmentStart;
    }

    cursor = startOfZonedDayPlus(cursor, 1, config.timeZone);
  }

  return totalMs / MS_PER_HOUR;
}

/**
 * "45m", "3h 30m", "2d 1h" — days counted at one working day per
 * `hoursPerWorkingDay()` (9h by default), as the spec requires.
 */
export function humaniseDuration(
  hours: number | null | undefined,
  config: WorkHoursConfig = workHoursConfig(),
): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "—";
  if (hours <= 0) return "0m";

  const perDay = hoursPerWorkingDay(config);
  const totalMinutes = Math.round(hours * 60);

  if (totalMinutes < 60) return `${totalMinutes}m`;

  const perDayMinutes = perDay * 60;

  if (totalMinutes < perDayMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  const days = Math.floor(totalMinutes / perDayMinutes);
  const remainderMinutes = totalMinutes - days * perDayMinutes;
  const h = Math.floor(remainderMinutes / 60);
  return h === 0 ? `${days}d` : `${days}d ${h}h`;
}

/** Median, reported alongside the mean so one runaway ticket cannot hide the norm. */
export function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2 === 1) return clean[mid]!;
  return (clean[mid - 1]! + clean[mid]!) / 2;
}

/** Mean, with the same empty-input contract as `median`. */
export function mean(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}
