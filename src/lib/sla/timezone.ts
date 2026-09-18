/**
 * Timezone helpers built on the platform Intl API — no date library.
 *
 * Africa/Harare has no DST today, but nothing here assumes that: the offset is
 * resolved per-instant, so the working-hours engine stays correct if Radx ever
 * adds a site in a zone that does observe it.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** Python convention: Monday = 0 … Sunday = 6, matching the WORK_DAYS env var. */
  weekday: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_TO_PYTHON: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** Break an instant into wall-clock parts in the given timezone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  return {
    year: Number.parseInt(get("year"), 10),
    month: Number.parseInt(get("month"), 10),
    day: Number.parseInt(get("day"), 10),
    hour: Number.parseInt(get("hour"), 10),
    minute: Number.parseInt(get("minute"), 10),
    second: Number.parseInt(get("second"), 10),
    weekday: WEEKDAY_TO_PYTHON[get("weekday")] ?? 0,
  };
}

/** Offset of the timezone from UTC, in milliseconds, at the given instant. */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, date.getUTCMilliseconds());
  return asUtc - date.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
 *
 * Two passes: guess using the offset at the naive instant, then re-resolve
 * using the offset that actually applies at the guessed instant. That second
 * pass is what makes the result correct across a DST boundary.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  const corrected = new Date(naive - zoneOffsetMs(firstGuess, timeZone));
  return corrected;
}

/** Start of the given instant's day (00:00:00) in the timezone, as a UTC instant. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

/** Start of the day `n` days after the given instant's day, in the timezone. */
export function startOfZonedDayPlus(date: Date, days: number, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  // Normalise through UTC arithmetic so month/year rollover is handled for us,
  // then re-anchor the resulting calendar date in the target zone.
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0));
  return zonedTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
    timeZone,
  );
}

/** A specific wall-clock hour on the same calendar day as `date`. */
export function zonedHourOnSameDay(date: Date, hour: number, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, hour, 0, 0, timeZone);
}

/** Format an instant for display in the given timezone. */
export function formatInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...options,
  }).format(date);
}
