import { env } from "@/lib/config/env";
import { formatInZone } from "@/lib/sla/timezone";

/** Display formatting. Everything user-facing is rendered in Africa/Harare. */

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return formatInZone(value, env().WORK_TIMEZONE);
}

export function formatDate(value: Date | null | undefined): string {
  if (!value) return "—";
  return formatInZone(value, env().WORK_TIMEZONE, {
    hour: undefined,
    minute: undefined,
  });
}

/** "3 minutes ago", "in 2 hours" — relative to now, using the Intl formatter. */
export function formatRelative(value: Date | null | undefined, now = new Date()): string {
  if (!value) return "—";
  const diffMs = value.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600_000],
    ["month", 30 * 24 * 3600_000],
    ["day", 24 * 3600_000],
    ["hour", 3600_000],
    ["minute", 60_000],
  ];

  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** First name / surname split on the first space (spec §3.7). */
export function splitName(fullName: string): { firstName: string; surname: string } {
  const trimmed = fullName.trim();
  const index = trimmed.indexOf(" ");
  if (index === -1) return { firstName: trimmed, surname: "" };
  return { firstName: trimmed.slice(0, index), surname: trimmed.slice(index + 1).trim() };
}

/** Initials for avatar chips (spec §3.3, §3.7). */
export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Days remaining before a soft-deleted record is purged (spec §3.16). */
export function daysUntilPurge(deletedAt: Date | null, retentionDays = env().RECYCLE_BIN_RETENTION_DAYS): number {
  if (!deletedAt) return retentionDays;
  const elapsedDays = (Date.now() - deletedAt.getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(retentionDays - elapsedDays));
}

/** A password stored more than 30 days ago is stale (spec §3.7). */
export function isPasswordStale(setAt: Date | null, staleDays = 30): boolean {
  if (!setAt) return false;
  return Date.now() - setAt.getTime() > staleDays * 86_400_000;
}

export function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1).trimEnd()}…`;
}
