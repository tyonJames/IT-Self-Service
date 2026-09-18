import type { EquipmentStatus } from "@prisma/client";

/**
 * Equipment request state machine (spec §3.14, instruction §7).
 *
 * This map is the single source of truth. The server validates against it and
 * the UI renders its action buttons *from* it, so a stale browser tab cannot
 * offer a transition the server would reject — and a new transition is added
 * in exactly one place.
 */
export const EQUIPMENT_TRANSITIONS: Record<EquipmentStatus, EquipmentStatus[]> = {
  submitted: ["review", "approved", "declined", "hold"],
  review: ["approved", "declined", "hold"],
  approved: ["ordered", "issued", "hold", "declined"],
  ordered: ["issued", "hold", "declined"],
  hold: ["review", "approved", "declined"],
  declined: ["review"],
  issued: [], // terminal
};

export const EQUIPMENT_STATUSES: EquipmentStatus[] = [
  "submitted",
  "review",
  "approved",
  "ordered",
  "issued",
  "hold",
  "declined",
];

/** Spec §3.14 — which statuses count as still in play. */
export const OPEN_EQUIPMENT_STATUSES: EquipmentStatus[] = [
  "submitted",
  "review",
  "approved",
  "ordered",
  "hold",
];

export const CLOSED_EQUIPMENT_STATUSES: EquipmentStatus[] = ["issued", "declined"];

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  submitted: "Submitted",
  review: "Under review",
  approved: "Approved",
  ordered: "Ordered",
  issued: "Issued",
  hold: "On hold",
  declined: "Declined",
};

export const EQUIPMENT_STATUS_VARIANTS: Record<EquipmentStatus, string> = {
  submitted: "primary",
  review: "info",
  approved: "success",
  ordered: "warning",
  issued: "secondary",
  hold: "warning",
  declined: "danger",
};

export const EQUIPMENT_STATUS_ICONS: Record<EquipmentStatus, string> = {
  submitted: "bi-inbox",
  review: "bi-search",
  approved: "bi-check-circle",
  ordered: "bi-truck",
  issued: "bi-box-seam",
  hold: "bi-pause-circle",
  declined: "bi-x-circle",
};

/** The verb shown on the action button for each target status. */
export const EQUIPMENT_TRANSITION_VERBS: Record<EquipmentStatus, string> = {
  submitted: "Reopen as submitted",
  review: "Move to review",
  approved: "Approve",
  ordered: "Mark as ordered",
  issued: "Mark as issued",
  hold: "Put on hold",
  declined: "Decline",
};

export class InvalidTransitionError extends Error {
  readonly status = 409;
  constructor(readonly from: EquipmentStatus, readonly to: EquipmentStatus) {
    super(
      `Cannot move an equipment request from “${EQUIPMENT_STATUS_LABELS[from]}” to “${EQUIPMENT_STATUS_LABELS[to]}”.`,
    );
    this.name = "InvalidTransitionError";
  }
}

export function allowedTransitions(from: EquipmentStatus): EquipmentStatus[] {
  return EQUIPMENT_TRANSITIONS[from] ?? [];
}

export function canTransition(from: EquipmentStatus, to: EquipmentStatus): boolean {
  return allowedTransitions(from).includes(to);
}

export function assertTransition(from: EquipmentStatus, to: EquipmentStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(status: EquipmentStatus): boolean {
  return allowedTransitions(status).length === 0;
}

export function isOpenStatus(status: EquipmentStatus): boolean {
  return OPEN_EQUIPMENT_STATUSES.includes(status);
}
