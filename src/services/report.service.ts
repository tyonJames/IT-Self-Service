import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { notDeleted } from "@/repositories/soft-delete";
import { ticketRepository } from "@/repositories/ticket.repository";
import {
  overallCompliance,
  resolutionHours,
  slaComplianceByPriority,
  type SlaComplianceRow,
} from "@/lib/sla/sla";
import { mean, median } from "@/lib/sla/workhours";
import { env } from "@/lib/config/env";
import { zonedParts } from "@/lib/sla/timezone";
import { COUNTRY_CODES } from "@/lib/config/countries";
import { OPEN_TICKET_STATUSES } from "@/lib/domain/tickets";

/**
 * Reporting — the Command Centre dashboard and the period/asset reports
 * (spec §5.4).
 *
 * All aggregation happens in the database or over a minimal projection. The
 * SLA figures are working-hours figures throughout: the dashboard and the
 * ticket badges use the same functions, so they cannot disagree.
 */

export interface ReportPeriod {
  key: "7d" | "30d" | "90d" | "custom" | "all";
  from: Date | null;
  to: Date | null;
  label: string;
}

export function resolvePeriod(key: string | undefined, fromRaw?: string, toRaw?: string): ReportPeriod {
  const now = new Date();
  const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000);

  switch (key) {
    case "7d":
      return { key: "7d", from: daysAgo(7), to: now, label: "Last 7 days" };
    case "90d":
      return { key: "90d", from: daysAgo(90), to: now, label: "Last 90 days" };
    case "all":
      return { key: "all", from: null, to: null, label: "All time" };
    case "custom": {
      const from = fromRaw ? new Date(fromRaw) : null;
      const to = toRaw ? new Date(`${toRaw}T23:59:59.999`) : null;
      const validFrom = from && !Number.isNaN(from.getTime()) ? from : daysAgo(30);
      const validTo = to && !Number.isNaN(to.getTime()) ? to : now;
      return {
        key: "custom",
        from: validFrom,
        to: validTo,
        label: `${validFrom.toISOString().slice(0, 10)} → ${validTo.toISOString().slice(0, 10)}`,
      };
    }
    default:
      return { key: "30d", from: daysAgo(30), to: now, label: "Last 30 days" };
  }
}

export interface DashboardData {
  period: ReportPeriod;
  country: string | null;
  summary: {
    openTickets: number;
    overdueTickets: number;
    totalInPeriod: number;
    resolvedInPeriod: number;
    averageResolutionHours: number | null;
    medianResolutionHours: number | null;
    slaCompliance: number | null;
    unassigned: number;
  };
  byStatus: { key: string; label: string; count: number }[];
  byCategory: { key: string; label: string; count: number }[];
  byCountry: { key: string; label: string; count: number }[];
  trend: { date: string; created: number; resolved: number }[];
  slaTable: SlaComplianceRow[];
}

function periodWhere(period: ReportPeriod, country: string | null): Prisma.TicketWhereInput {
  return {
    ...notDeleted(),
    ...(country ? { country } : {}),
    ...(period.from || period.to
      ? {
          createdAt: {
            ...(period.from ? { gte: period.from } : {}),
            ...(period.to ? { lte: period.to } : {}),
          },
        }
      : {}),
  };
}

export const reportService = {
  async dashboard(period: ReportPeriod, country: string | null): Promise<DashboardData> {
    const where = periodWhere(period, country);
    const liveWhere: Prisma.TicketWhereInput = { ...notDeleted(), ...(country ? { country } : {}) };

    const [
      openTickets,
      overdueTickets,
      unassigned,
      statusRows,
      categoryRows,
      countryRows,
      slaFacts,
      categoryLabels,
    ] = await Promise.all([
      prisma.ticket.count({ where: { ...liveWhere, status: { in: OPEN_TICKET_STATUSES } } }),
      prisma.ticket.count({
        where: {
          ...liveWhere,
          status: { notIn: ["resolved", "closed"] },
          dueDate: { not: null, lt: new Date() },
        },
      }),
      prisma.ticket.count({
        where: { ...liveWhere, assignedToId: null, status: { in: OPEN_TICKET_STATUSES } },
      }),
      ticketRepository.countByStatus(where),
      ticketRepository.countByCategory(where),
      ticketRepository.countByCountry(where),
      ticketRepository.slaFacts(where),
      prisma.ticketCategory.findMany({ select: { slug: true, name: true } }),
    ]);

    const labelMap = new Map(categoryLabels.map((c) => [c.slug, c.name]));

    const resolved = slaFacts.filter((t) => t.resolvedAt !== null);
    const durations = resolved
      .map((t) => resolutionHours({ createdAt: t.createdAt, resolvedAt: t.resolvedAt }))
      .filter((v): v is number => v !== null);

    return {
      period,
      country,
      summary: {
        openTickets,
        overdueTickets,
        totalInPeriod: slaFacts.length,
        resolvedInPeriod: resolved.length,
        averageResolutionHours: mean(durations),
        medianResolutionHours: median(durations),
        slaCompliance: overallCompliance(slaFacts),
        unassigned,
      },
      byStatus: statusRows.map((r) => ({
        key: r.status,
        label: r.status.replace("_", " "),
        count: r._count._all,
      })),
      byCategory: categoryRows
        .map((r) => ({ key: r.category, label: labelMap.get(r.category) ?? r.category, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      byCountry: countryRows.map((r) => ({ key: r.country, label: r.country, count: r._count._all })),
      trend: await this.trend(period, country),
      slaTable: slaComplianceByPriority(slaFacts),
    };
  },

  /**
   * Daily created/resolved counts.
   *
   * Bucketing happens in the application rather than in SQL because the bucket
   * boundary must be midnight in Africa/Harare, not midnight UTC — a ticket
   * raised at 01:00 on Tuesday in Harare belongs to Tuesday, not Monday.
   */
  async trend(period: ReportPeriod, country: string | null) {
    const to = period.to ?? new Date();
    const from = period.from ?? new Date(to.getTime() - 30 * 86_400_000);
    const tz = env().WORK_TIMEZONE;

    const [created, resolved] = await Promise.all([
      prisma.ticket.findMany({
        where: { ...notDeleted(), ...(country ? { country } : {}), createdAt: { gte: from, lte: to } },
        select: { createdAt: true },
      }),
      prisma.ticket.findMany({
        where: {
          ...notDeleted(),
          ...(country ? { country } : {}),
          resolvedAt: { gte: from, lte: to },
        },
        select: { resolvedAt: true },
      }),
    ]);

    const key = (d: Date): string => {
      const p = zonedParts(d, tz);
      return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    };

    const buckets = new Map<string, { created: number; resolved: number }>();

    // Seed every day in range so the chart shows the gaps rather than
    // silently connecting across them.
    for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
      buckets.set(key(new Date(t)), { created: 0, resolved: 0 });
    }

    for (const row of created) {
      const bucket = buckets.get(key(row.createdAt));
      if (bucket) bucket.created += 1;
    }
    for (const row of resolved) {
      if (!row.resolvedAt) continue;
      const bucket = buckets.get(key(row.resolvedAt));
      if (bucket) bucket.resolved += 1;
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));
  },

  /** Asset breakdown tab (spec §5.4). */
  async assetBreakdown(country: string | null) {
    const where: Prisma.AssetWhereInput = { ...notDeleted(), ...(country ? { site: country } : {}) };

    const [byCategory, byStatus, byCountry, total, inService, tracked] = await Promise.all([
      prisma.asset.groupBy({ by: ["category"], where, _count: { _all: true } }),
      prisma.asset.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.asset.groupBy({ by: ["site"], where: notDeleted(), _count: { _all: true } }),
      prisma.asset.count({ where }),
      prisma.asset.count({ where: { ...where, status: { notIn: ["retired", "stolen"] } } }),
      prisma.asset.count({ where: { ...where, trackingEnabled: true } }),
    ]);

    return {
      total,
      inService,
      tracked,
      byCategory: byCategory.map((r) => ({ key: r.category, count: r._count._all })),
      byStatus: byStatus.map((r) => ({ key: r.status, count: r._count._all })),
      byCountry: byCountry.map((r) => ({ key: r.site, count: r._count._all })),
    };
  },

  /** Period report (spec route /tickets/reports/period/). */
  async periodReport(period: ReportPeriod, country: string | null) {
    const where = periodWhere(period, country);
    const facts = await ticketRepository.slaFacts(where);

    const resolved = facts.filter((f) => f.resolvedAt !== null);
    const durations = resolved
      .map((t) => resolutionHours({ createdAt: t.createdAt, resolvedAt: t.resolvedAt }))
      .filter((v): v is number => v !== null);

    const byCountry = await Promise.all(
      COUNTRY_CODES.map(async (code) => {
        const countryFacts = await ticketRepository.slaFacts({ ...where, country: code });
        const countryResolved = countryFacts.filter((f) => f.resolvedAt !== null);
        const countryDurations = countryResolved
          .map((t) => resolutionHours({ createdAt: t.createdAt, resolvedAt: t.resolvedAt }))
          .filter((v): v is number => v !== null);
        return {
          code,
          total: countryFacts.length,
          resolved: countryResolved.length,
          averageHours: mean(countryDurations),
          medianHours: median(countryDurations),
          compliance: overallCompliance(countryFacts),
        };
      }),
    );

    return {
      period,
      country,
      total: facts.length,
      resolved: resolved.length,
      stillOpen: facts.filter((f) => OPEN_TICKET_STATUSES.includes(f.status)).length,
      averageHours: mean(durations),
      medianHours: median(durations),
      fastestHours: durations.length > 0 ? Math.min(...durations) : null,
      slowestHours: durations.length > 0 ? Math.max(...durations) : null,
      compliance: overallCompliance(facts),
      slaTable: slaComplianceByPriority(facts),
      byCountry,
    };
  },
};
