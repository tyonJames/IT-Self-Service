import type { AssetCategory, AssetStatus } from "@prisma/client";

/**
 * Asset domain rules (spec §3.4).
 */

/** Every category, including the legacy one. */
export const ALL_ASSET_CATEGORIES: AssetCategory[] = [
  "laptop",
  "desktop",
  "phone",
  "printer",
  "monitor",
  "clocking",
  "starlink",
  "other",
  "computer",
];

/**
 * Categories offered in dropdowns. "computer" is deliberately absent: old
 * records keep it and it renders everywhere, but nothing new can be created
 * with it (spec §3.4, CC-008).
 */
export const SELECTABLE_ASSET_CATEGORIES: AssetCategory[] = [
  "laptop",
  "desktop",
  "phone",
  "printer",
  "monitor",
  "clocking",
  "starlink",
  "other",
];

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  laptop: "Laptop",
  desktop: "Desktop",
  phone: "Phone",
  printer: "Printer",
  monitor: "Monitor",
  clocking: "Clocking device",
  starlink: "Starlink",
  other: "Other",
  computer: "Computer (legacy)",
};

export const ASSET_CATEGORY_ICONS: Record<AssetCategory, string> = {
  laptop: "bi-laptop",
  desktop: "bi-pc-display",
  phone: "bi-phone",
  printer: "bi-printer",
  monitor: "bi-display",
  clocking: "bi-fingerprint",
  starlink: "bi-broadcast-pin",
  other: "bi-box-seam",
  computer: "bi-pc",
};

/**
 * Categories that belong to a site rather than a person (spec §3.4).
 * Only laptops and phones follow an individual around.
 */
export const SITE_CATEGORIES: ReadonlySet<AssetCategory> = new Set<AssetCategory>([
  "desktop",
  "printer",
  "monitor",
  "clocking",
  "starlink",
  "other",
]);

export function isSiteCategory(category: AssetCategory): boolean {
  return SITE_CATEGORIES.has(category);
}

/**
 * Which spec fields are relevant to which category. The asset form reads this
 * to show and hide field groups, and the detail page reads it to decide which
 * rows are worth rendering.
 */
export const CATEGORY_FIELDS: Record<AssetCategory, string[]> = {
  laptop: ["macAddress", "osVersion", "officeVersion"],
  desktop: ["macAddress", "osVersion", "officeVersion"],
  computer: ["macAddress", "osVersion", "officeVersion", "laptopOrDesktop"],
  phone: ["imei1", "imei2", "cellNumber", "package"],
  printer: ["printerType", "tonerType"],
  clocking: ["ipAddress", "areaCode"],
  monitor: [],
  starlink: [],
  other: [],
};

export const ASSET_SPEC_FIELD_LABELS: Record<string, string> = {
  macAddress: "MAC address",
  osVersion: "OS version",
  officeVersion: "Office version",
  laptopOrDesktop: "Laptop or desktop",
  imei1: "IMEI 1",
  imei2: "IMEI 2",
  cellNumber: "Cell number",
  package: "Package",
  printerType: "Printer type",
  tonerType: "Toner type",
  ipAddress: "IP address",
  areaCode: "Area code",
};

/** Categories whose devices can run the tracking agent. */
export const TRACKABLE_CATEGORIES: ReadonlySet<AssetCategory> = new Set<AssetCategory>([
  "laptop",
  "desktop",
  "computer",
]);

export const ASSET_STATUSES: AssetStatus[] = [
  "active",
  "faulty",
  "repair",
  "retired",
  "spare",
  "return_pending",
  "stolen",
];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: "Active",
  faulty: "Faulty",
  repair: "In repair",
  retired: "Retired",
  spare: "Spare",
  return_pending: "Return pending",
  stolen: "Stolen",
};

/** Bootstrap contextual classes from spec §3.4. */
export const ASSET_STATUS_VARIANTS: Record<AssetStatus, string> = {
  active: "success",
  faulty: "danger",
  repair: "warning",
  retired: "secondary",
  spare: "info",
  return_pending: "warning",
  stolen: "dark",
};

/** Statuses excluded from "in service" counts (spec §3.4). */
export const STATUSES_GONE: AssetStatus[] = ["retired", "stolen"];

export function isInService(status: AssetStatus): boolean {
  return !STATUSES_GONE.includes(status);
}

// ---------------------------------------------------------------------------
// Repair recommendation (spec §3.4)
// ---------------------------------------------------------------------------

export type RepairRecommendation = "replace" | "watch" | "ok";

export interface RepairAdvice {
  recommendation: RepairRecommendation;
  variant: "danger" | "warning" | "success";
  label: string;
  detail: string;
}

/**
 * Turn a fault count into advice. Faults are counted from tickets whose
 * *subject* is this asset, so attaching a second device to someone else's
 * ticket does not inflate this number (CC-007).
 */
export function repairRecommendation(faultCount: number): RepairAdvice {
  if (faultCount >= 4) {
    return {
      recommendation: "replace",
      variant: "danger",
      label: "Replace",
      detail: `${faultCount} recorded faults — repeated repair is costing more than replacement.`,
    };
  }
  if (faultCount >= 2) {
    return {
      recommendation: "watch",
      variant: "warning",
      label: "Watch",
      detail: `${faultCount} recorded faults — keep an eye on this one.`,
    };
  }
  return {
    recommendation: "ok",
    variant: "success",
    label: "Healthy",
    detail: faultCount === 0 ? "No faults recorded." : "1 recorded fault.",
  };
}

/** Initials for the avatar chip on grid cards and 360 views. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
