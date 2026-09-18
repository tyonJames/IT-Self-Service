import type { TicketPriority } from "@prisma/client";
import { addWorkingHours, humaniseDuration, workingHoursBetween } from "./workhours";

/**
 * SLA targets, in WORKING hours.
 *
 * ⚠ These values are transcribed verbatim from the specification (spec §3.9,
 * instruction §6), where `critical` is given the *longest* target and `low` the
 * shortest. That is inverted relative to convention and is almost certainly a
 * defect carried over from the Django original — it is flagged as CC-002 in
 * docs/CHANGE_CONTROL.md and deliberately NOT changed here.
 *
 * If Radx confirms the intent, changing this one object (and the matching
 * assertion in tests/unit/sla.test.ts) is the entire fix; run
 * `npm run recalculate-sla` afterwards to restate open tickets' due dates.
 */
export const SLA_TARGET_HOURS: Record<TicketPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const PRIORITY_ORDER: TicketPriority[] = ["critical", "high", "medium", "low"];

/** SLA deadline for a ticket created at `createdAt` with the given priority. */
export function slaDueDate(createdAt: Date, priority: TicketPriority): Date {
  return addWorkingHours(createdAt, SLA_TARGET_HOURS[priority]);
}

export interface SlaState {
  dueDate: Date | null;
  /** Working hours remaining until due; negative when breached. */
  hoursRemaining: number | null;
  isOverdue: boolean;
  /** Human-readable "2h 15m left" / "1d 2h overdue". */
  label: string;
  /** Bootstrap contextual class for the badge. */
  variant: "success" | "warning" | "danger" | "secondary";
}

/**
 * Evaluate a ticket's SLA position.
 *
 * A resolved or closed ticket is measured against when it was resolved, not
 * against now — otherwise every historic ticket drifts into "overdue" simply
 * because time passed after it was fixed.
 */
export function evaluateSla(args: {
  dueDate: Date | null;
  resolvedAt: Date | null;
  now?: Date;
}): SlaState {
  const { dueDate, resolvedAt } = args;
  const now = args.now ?? new Date();

  if (!dueDate) {
    return { dueDate: null, hoursRemaining: null, isOverdue: false, label: "No SLA", variant: "secondary" };
  }

  const reference = resolvedAt ?? now;
  const breached = reference.getTime() > dueDate.getTime();

  const hours = breached
    ? -workingHoursBetween(dueDate, reference)
    : workingHoursBetween(reference, dueDate);

  if (breached) {
    return {
      dueDate,
      hoursRemaining: hours,
      isOverdue: true,
      label: `${humaniseDuration(Math.abs(hours))} overdue`,
      variant: "danger",
    };
  }

  // Under a quarter of the shortest target left is "cutting it fine".
  const variant: SlaState["variant"] = hours <= 0.5 ? "warning" : "success";
  return {
    dueDate,
    hoursRemaining: hours,
    isOverdue: false,
    label: `${humaniseDuration(hours)} left`,
    variant,
  };
}

/** Working hours a ticket took to resolve, or null if it is still open. */
export function resolutionHours(ticket: { createdAt: Date; resolvedAt: Date | null }): number | null {
  if (!ticket.resolvedAt) return null;
  return workingHoursBetween(ticket.createdAt, ticket.resolvedAt);
}

/** Was this ticket resolved within its SLA? Unresolved tickets return null. */
export function metSla(ticket: { dueDate: Date | null; resolvedAt: Date | null }): boolean | null {
  if (!ticket.resolvedAt || !ticket.dueDate) return null;
  return ticket.resolvedAt.getTime() <= ticket.dueDate.getTime();
}

export interface SlaComplianceRow {
  priority: TicketPriority;
  targetHours: number;
  total: number;
  met: number;
  breached: number;
  /** null when there is nothing to measure — rendered as "—", never as 0%. */
  compliancePercent: number | null;
}

/** Build the dashboard's SLA-by-priority table (spec §5.4). */
export function slaComplianceByPriority(
  tickets: { priority: TicketPriority; dueDate: Date | null; resolvedAt: Date | null }[],
): SlaComplianceRow[] {
  return PRIORITY_ORDER.map((priority) => {
    const subset = tickets.filter((t) => t.priority === priority);
    const measurable = subset.filter((t) => t.resolvedAt !== null && t.dueDate !== null);
    const met = measurable.filter((t) => metSla(t) === true).length;
    const breached = measurable.length - met;
    return {
      priority,
      targetHours: SLA_TARGET_HOURS[priority],
      total: subset.length,
      met,
      breached,
      compliancePercent: measurable.length === 0 ? null : (met / measurable.length) * 100,
    };
  });
}

/** Overall compliance across every measurable ticket. */
export function overallCompliance(
  tickets: { dueDate: Date | null; resolvedAt: Date | null }[],
): number | null {
  const measurable = tickets.filter((t) => t.resolvedAt !== null && t.dueDate !== null);
  if (measurable.length === 0) return null;
  const met = measurable.filter((t) => metSla(t) === true).length;
  return (met / measurable.length) * 100;
}
