import { NextResponse, type NextRequest } from "next/server";
import type { TicketPriority, TicketStatus } from "@prisma/client";
import { requireApiAgent } from "@/lib/permissions";
import { exportService } from "@/services/export.service";
import { resolvePeriod } from "@/services/report.service";
import { auditService } from "@/services/audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import { handleApiError } from "@/lib/api/respond";
import { ticketFilterSchema } from "@/lib/validation/tickets";
import { OPEN_TICKET_STATUSES } from "@/lib/domain/tickets";
import type { TicketFilters } from "@/repositories/ticket.repository";

export const dynamic = "force-dynamic";

/**
 * `/tickets/export/excel/` — the ticket list as a spreadsheet.
 * The export honours whatever filters the list was showing (instruction §20).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireApiAgent();

    const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = ticketFilterSchema.parse(raw);
    const period = resolvePeriod(raw.period, raw.from, raw.to);

    const filters: TicketFilters = {
      status: (query.status as TicketStatus | undefined) ?? null,
      priority: (query.priority as TicketPriority | undefined) ?? null,
      category: query.category ?? null,
      country: query.country ?? null,
      search: query.q ?? null,
      createdFrom: period.from,
      createdTo: period.to,
    };

    if (query.tab === "open") filters.statusIn = OPEN_TICKET_STATUSES;
    if (query.tab === "overdue") filters.overdueOnly = true;
    if (query.tab === "resolved") filters.statusIn = ["resolved", "closed"];
    if (query.tab === "mine") filters.assignedToId = session.user.id;

    const buffer = await exportService.ticketsToExcel(filters, period.label);

    await auditService.record({
      event: SecurityEvent.FILE_ACCESS,
      message: "Exported tickets to Excel",
      actorId: session.user.id,
      actorRepr: session.user.username,
      target: "Ticket",
      detail: { period: period.label, tab: query.tab },
    });

    const filename = `radx-tickets-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, "GET /tickets/export/excel");
  }
}
