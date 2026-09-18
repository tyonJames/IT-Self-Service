import type { TicketPriority, TicketStatus } from "@prisma/client";

/** Ticket presentation rules (spec §3.9). */

export const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
};

/** Spec §3.9 badge mapping. */
export const TICKET_STATUS_VARIANTS: Record<TicketStatus, string> = {
  open: "danger",
  in_progress: "warning",
  waiting: "info",
  resolved: "success",
  closed: "secondary",
};

export const TICKET_STATUS_ICONS: Record<TicketStatus, string> = {
  open: "bi-exclamation-circle",
  in_progress: "bi-arrow-repeat",
  waiting: "bi-hourglass-split",
  resolved: "bi-check-circle",
  closed: "bi-archive",
};

/** Statuses that count as "still needs someone" on the dashboard. */
export const OPEN_TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "waiting"];

export function isOpenTicketStatus(status: TicketStatus): boolean {
  return OPEN_TICKET_STATUSES.includes(status);
}

export const TICKET_PRIORITIES: TicketPriority[] = ["critical", "high", "medium", "low"];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const TICKET_PRIORITY_VARIANTS: Record<TicketPriority, string> = {
  critical: "danger",
  high: "warning",
  medium: "primary",
  low: "secondary",
};

/** Device types offered on the ticket forms (spec §3.9). */
export const TICKET_DEVICE_TYPES = [
  { value: "laptop", label: "Laptop" },
  { value: "desktop", label: "Desktop" },
  { value: "printer", label: "Printer" },
  { value: "monitor", label: "Monitor" },
  { value: "clocking", label: "Clocking device" },
  { value: "starlink", label: "Starlink" },
  { value: "other", label: "Other" },
] as const;

/** Reference number RDX-0042 — derived from the primary key (spec §3.9). */
export function ticketReference(id: number): string {
  return `RDX-${String(id).padStart(4, "0")}`;
}

/** Parse "RDX-0042", "rdx 42" or "42" back to an id, for the search box. */
export function parseTicketReference(raw: string): number | null {
  const cleaned = raw.trim().toUpperCase().replace(/^RDX[-\s]?/, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const id = Number.parseInt(cleaned, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Named filter tabs on the ticket list (spec §5.5). */
export const TICKET_LIST_TABS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "mine", label: "My tickets" },
  { key: "overdue", label: "Overdue" },
  { key: "resolved", label: "Resolved" },
] as const;

export type TicketListTab = (typeof TICKET_LIST_TABS)[number]["key"];
