import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { StaffGroup } from "@prisma/client";
import { ticketRepository, type TicketFilters } from "@/repositories/ticket.repository";
import { employeeRepository } from "@/repositories/employee.repository";
import { lookupRepository } from "@/repositories/lookup.repository";
import { countryName, COUNTRY_CODES } from "@/lib/config/countries";
import { ticketReference } from "@/lib/domain/tickets";
import { resolutionHours, slaComplianceByPriority, metSla } from "@/lib/sla/sla";
import { humaniseDuration, mean, median } from "@/lib/sla/workhours";
import { formatDateTime, splitName } from "@/lib/utils/format";
import type { ReportPeriod } from "./report.service";

/**
 * Excel and PDF exports (spec §5.12, §5.17; instruction §20).
 *
 * Exports are generated server-side and respect the caller's current filters,
 * so an export can never contain more than the user could already see on
 * screen. Resolution times are working-hours figures, matching the dashboard.
 */

const BRAND = "2D7A45";

async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND}` } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
}

export const exportService = {
  /** Ticket export with working-hours resolution time (spec §5.17). */
  async ticketsToExcel(filters: TicketFilters, periodLabel: string): Promise<Buffer> {
    const [tickets, categories] = await Promise.all([
      ticketRepository.listForExport(filters),
      lookupRepository.ticketCategoryLabels(),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Radx IT Help Desk";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Tickets", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "Reference", key: "ref", width: 12 },
      { header: "Title", key: "title", width: 44 },
      { header: "Status", key: "status", width: 13 },
      { header: "Priority", key: "priority", width: 11 },
      { header: "Category", key: "category", width: 22 },
      { header: "Country", key: "country", width: 15 },
      { header: "Site", key: "site", width: 22 },
      { header: "Reporter", key: "reporter", width: 24 },
      { header: "Reporter email", key: "email", width: 30 },
      { header: "Department", key: "department", width: 20 },
      { header: "Assigned to", key: "assigned", width: 22 },
      { header: "Asset", key: "asset", width: 16 },
      { header: "Raised", key: "created", width: 20 },
      { header: "SLA due", key: "due", width: 20 },
      { header: "Resolved", key: "resolved", width: 20 },
      { header: "Working hours to resolve", key: "hours", width: 24 },
      { header: "Met SLA", key: "met", width: 10 },
    ];

    styleHeader(sheet.getRow(1));

    for (const ticket of tickets) {
      const hours = resolutionHours(ticket);
      const met = metSla(ticket);
      sheet.addRow({
        ref: ticketReference(ticket.id),
        title: ticket.title,
        status: ticket.status.replace("_", " "),
        priority: ticket.priority,
        category: categories.get(ticket.category) ?? ticket.category,
        country: countryName(ticket.country),
        site: ticket.siteName,
        reporter: ticket.employee?.fullName ?? ticket.submitterName,
        email: ticket.submitterEmail,
        department: ticket.employee?.department ?? "",
        assigned: ticket.assignedTo
          ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`.trim() ||
            ticket.assignedTo.username
          : "",
        asset: ticket.asset?.assetTag ?? ticket.assetNumber,
        created: formatDateTime(ticket.createdAt),
        due: ticket.dueDate ? formatDateTime(ticket.dueDate) : "",
        resolved: ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : "",
        hours: hours === null ? "" : Number(hours.toFixed(2)),
        met: met === null ? "" : met ? "Yes" : "No",
      });
    }

    sheet.autoFilter = { from: "A1", to: { row: 1, column: sheet.columnCount } };

    // A summary sheet, because the first question anyone asks of an export is
    // "so what does it say".
    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
      { header: "Measure", key: "measure", width: 34 },
      { header: "Value", key: "value", width: 24 },
    ];
    styleHeader(summary.getRow(1));

    const durations = tickets
      .map((t) => resolutionHours(t))
      .filter((v): v is number => v !== null);

    summary.addRow({ measure: "Period", value: periodLabel });
    summary.addRow({ measure: "Tickets exported", value: tickets.length });
    summary.addRow({
      measure: "Resolved",
      value: tickets.filter((t) => t.resolvedAt !== null).length,
    });
    summary.addRow({ measure: "Average working hours to resolve", value: humaniseDuration(mean(durations)) });
    summary.addRow({ measure: "Median working hours to resolve", value: humaniseDuration(median(durations)) });
    summary.addRow({ measure: "Generated", value: formatDateTime(new Date()) });

    summary.addRow({});
    const slaHeader = summary.addRow({ measure: "SLA compliance by priority", value: "" });
    slaHeader.font = { bold: true };

    for (const row of slaComplianceByPriority(tickets)) {
      summary.addRow({
        measure: `  ${row.priority} (target ${row.targetHours}h)`,
        value:
          row.compliancePercent === null
            ? "no resolved tickets"
            : `${row.compliancePercent.toFixed(1)}% (${row.met} met, ${row.breached} breached)`,
      });
    }

    return workbookToBuffer(workbook);
  },

  /** Ticket PDF with the SLA compliance table (spec §5.17). */
  async ticketsToPdf(filters: TicketFilters, periodLabel: string): Promise<Buffer> {
    const [tickets, categories] = await Promise.all([
      ticketRepository.listForExport(filters),
      lookupRepository.ticketCategoryLabels(),
    ]);

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    // Header
    doc.rect(0, 0, doc.page.width, 54).fill(`#${BRAND}`);
    doc.fillColor("#ffffff").fontSize(16).text("Radx IT Help Desk — Ticket report", 36, 18);
    doc.fontSize(9).text(`${periodLabel} · generated ${formatDateTime(new Date())}`, 36, 38);
    doc.fillColor("#000000");

    doc.moveDown(2.5);

    // SLA summary
    const durations = tickets.map((t) => resolutionHours(t)).filter((v): v is number => v !== null);

    doc.fontSize(12).text("Summary", { underline: false });
    doc.moveDown(0.3);
    doc.fontSize(9);
    doc.text(`Tickets: ${tickets.length}    Resolved: ${tickets.filter((t) => t.resolvedAt).length}`);
    doc.text(
      `Average time to resolve: ${humaniseDuration(mean(durations))}    Median: ${humaniseDuration(median(durations))}`,
    );
    doc.text("Times are working hours — Monday to Friday, 08:00–17:00, Africa/Harare.");
    doc.moveDown(0.8);

    doc.fontSize(12).text("SLA compliance by priority");
    doc.moveDown(0.3);

    const slaRows = slaComplianceByPriority(tickets);
    const slaColumns = [110, 70, 70, 70, 80, 90];
    let x = 36;
    let y = doc.y;

    doc.fontSize(9).fillColor("#ffffff");
    doc.rect(36, y - 2, slaColumns.reduce((a, b) => a + b, 0), 16).fill(`#${BRAND}`);
    doc.fillColor("#ffffff");
    ["Priority", "Target", "Tickets", "Met", "Breached", "Compliance"].forEach((label, i) => {
      doc.text(label, x + 4, y + 2, { width: slaColumns[i]! - 8 });
      x += slaColumns[i]!;
    });
    doc.fillColor("#000000");
    y += 18;

    for (const row of slaRows) {
      x = 36;
      const cells = [
        row.priority,
        `${row.targetHours}h`,
        String(row.total),
        String(row.met),
        String(row.breached),
        row.compliancePercent === null ? "—" : `${row.compliancePercent.toFixed(1)}%`,
      ];
      cells.forEach((cell, i) => {
        doc.text(cell, x + 4, y, { width: slaColumns[i]! - 8 });
        x += slaColumns[i]!;
      });
      y += 14;
    }

    doc.y = y + 12;

    // Ticket table
    doc.fontSize(12).text("Tickets");
    doc.moveDown(0.3);

    const columns = [
      { label: "Ref", width: 52 },
      { label: "Title", width: 200 },
      { label: "Status", width: 62 },
      { label: "Priority", width: 52 },
      { label: "Category", width: 92 },
      { label: "Country", width: 72 },
      { label: "Reporter", width: 110 },
      { label: "Raised", width: 92 },
      { label: "Resolve time", width: 70 },
    ];
    const tableWidth = columns.reduce((a, c) => a + c.width, 0);

    const drawHeader = (): void => {
      doc.fontSize(8);
      doc.rect(36, doc.y - 2, tableWidth, 15).fill(`#${BRAND}`);
      doc.fillColor("#ffffff");
      let cx = 36;
      const cy = doc.y + 2;
      for (const column of columns) {
        doc.text(column.label, cx + 3, cy, { width: column.width - 6, lineBreak: false });
        cx += column.width;
      }
      doc.fillColor("#000000");
      doc.y = cy + 14;
    };

    drawHeader();

    for (const ticket of tickets) {
      if (doc.y > doc.page.height - 50) {
        doc.addPage();
        drawHeader();
      }

      const hours = resolutionHours(ticket);
      const cells = [
        ticketReference(ticket.id),
        ticket.title.length > 60 ? `${ticket.title.slice(0, 57)}…` : ticket.title,
        ticket.status.replace("_", " "),
        ticket.priority,
        categories.get(ticket.category) ?? ticket.category,
        countryName(ticket.country),
        (ticket.employee?.fullName ?? ticket.submitterName ?? "").slice(0, 26),
        formatDateTime(ticket.createdAt),
        hours === null ? "—" : humaniseDuration(hours),
      ];

      let cx = 36;
      const cy = doc.y;
      doc.fontSize(8);
      cells.forEach((cell, i) => {
        doc.text(cell, cx + 3, cy, { width: columns[i]!.width - 6, lineBreak: false });
        cx += columns[i]!.width;
      });
      doc.y = cy + 12;
    }

    doc.end();
    return done;
  },

  /** Email register, Excel (spec §5.12). */
  async emailRegisterToExcel(): Promise<Buffer> {
    const employees = await employeeRepository.listAll({ activeOnly: true });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Radx IT Help Desk";

    const sheet = workbook.addWorksheet("Email register", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "Group", key: "group", width: 14 },
      { header: "Country", key: "country", width: 15 },
      { header: "First name", key: "first", width: 18 },
      { header: "Surname", key: "surname", width: 22 },
      { header: "Work email", key: "email", width: 34 },
      { header: "Other email", key: "alt", width: 34 },
      { header: "Department", key: "department", width: 22 },
      { header: "Job title", key: "title", width: 26 },
    ];
    styleHeader(sheet.getRow(1));

    for (const employee of employees) {
      const { firstName, surname } = splitName(employee.fullName);
      sheet.addRow({
        group: employee.staffGroup,
        country: countryName(employee.site),
        first: firstName,
        surname,
        email: employee.email,
        alt: employee.altEmail,
        department: employee.department,
        title: employee.jobTitle,
      });
    }

    sheet.autoFilter = { from: "A1", to: { row: 1, column: sheet.columnCount } };
    return workbookToBuffer(workbook);
  },

  /**
   * Email register, PDF (spec §5.12).
   *
   * Grouped exactly as specified: Management first, then everyone else by
   * country, with a page break between groups so each section can be handed to
   * the people it concerns.
   */
  async emailRegisterToPdf(): Promise<Buffer> {
    const employees = await employeeRepository.listAll({ activeOnly: true });

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const groups: { title: string; rows: typeof employees }[] = [];

    const management = employees.filter((e) => e.staffGroup === "management");
    if (management.length > 0) groups.push({ title: "Management", rows: management });

    for (const code of COUNTRY_CODES) {
      const rows = employees.filter((e) => e.staffGroup !== "management" && e.site === code);
      if (rows.length > 0) groups.push({ title: countryName(code), rows });
    }

    const consultantsElsewhere = employees.filter(
      (e) =>
        e.staffGroup !== "management" && !(COUNTRY_CODES as readonly string[]).includes(e.site),
    );
    if (consultantsElsewhere.length > 0) {
      groups.push({ title: "Other", rows: consultantsElsewhere });
    }

    const columns = [
      { label: "First name", width: 95 },
      { label: "Surname", width: 110 },
      { label: "Work email", width: 165 },
      { label: "Other email", width: 145 },
    ];
    const tableWidth = columns.reduce((a, c) => a + c.width, 0);

    groups.forEach((group, index) => {
      if (index > 0) doc.addPage();

      doc.rect(0, 0, doc.page.width, 52).fill(`#${BRAND}`);
      doc.fillColor("#ffffff").fontSize(15).text("Radx email register", 40, 15);
      doc.fontSize(10).text(group.title, 40, 34);
      doc.fillColor("#000000");
      doc.y = 70;

      const drawHeader = (): void => {
        doc.fontSize(9);
        doc.rect(40, doc.y - 2, tableWidth, 16).fill("#e8f5ed");
        doc.fillColor("#1e5a31");
        let cx = 40;
        const cy = doc.y + 3;
        for (const column of columns) {
          doc.text(column.label, cx + 4, cy, { width: column.width - 8, lineBreak: false });
          cx += column.width;
        }
        doc.fillColor("#000000");
        doc.y = cy + 15;
      };

      drawHeader();

      const sorted = [...group.rows].sort((a, b) => {
        const left = splitName(a.fullName);
        const right = splitName(b.fullName);
        return (
          left.surname.localeCompare(right.surname) || left.firstName.localeCompare(right.firstName)
        );
      });

      for (const employee of sorted) {
        if (doc.y > doc.page.height - 60) {
          doc.addPage();
          doc.y = 40;
          drawHeader();
        }

        const { firstName, surname } = splitName(employee.fullName);
        const cells = [firstName, surname, employee.email, employee.altEmail];

        let cx = 40;
        const cy = doc.y;
        doc.fontSize(9);
        cells.forEach((cell, i) => {
          doc.text(cell, cx + 4, cy, { width: columns[i]!.width - 8, lineBreak: false });
          cx += columns[i]!.width;
        });
        doc.y = cy + 14;
      }

      doc.fontSize(8).fillColor("#6c757d");
      doc.text(
        `${sorted.length} ${sorted.length === 1 ? "person" : "people"} · generated ${formatDateTime(new Date())}`,
        40,
        doc.page.height - 45,
      );
      doc.fillColor("#000000");
    });

    if (groups.length === 0) {
      doc.fontSize(12).text("No active employees on file.", 40, 80);
    }

    doc.end();
    return done;
  },

  /** Asset export used by the asset report tab. */
  async assetsToExcel(rows: {
    assetTag: string | null;
    category: string;
    brand: string;
    model: string;
    serialNumber: string;
    status: string;
    site: string;
    location: string;
    department: string;
    assignedToName: string;
    lastSeenAt: Date | null;
    lastSeenLocation: string;
  }[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Radx IT Help Desk";

    const sheet = workbook.addWorksheet("Assets", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "Tag", key: "tag", width: 14 },
      { header: "Type", key: "category", width: 14 },
      { header: "Make", key: "brand", width: 18 },
      { header: "Model", key: "model", width: 22 },
      { header: "Serial", key: "serial", width: 22 },
      { header: "Status", key: "status", width: 16 },
      { header: "Country", key: "country", width: 15 },
      { header: "Site", key: "site", width: 22 },
      { header: "Department", key: "department", width: 20 },
      { header: "Holder", key: "holder", width: 26 },
      { header: "Last seen", key: "lastSeen", width: 20 },
      { header: "Last location", key: "lastLocation", width: 26 },
    ];
    styleHeader(sheet.getRow(1));

    for (const asset of rows) {
      sheet.addRow({
        tag: asset.assetTag ?? "",
        category: asset.category,
        brand: asset.brand,
        model: asset.model,
        serial: asset.serialNumber,
        status: asset.status.replace("_", " "),
        country: countryName(asset.site),
        site: asset.location,
        department: asset.department,
        holder: asset.assignedToName,
        lastSeen: asset.lastSeenAt ? formatDateTime(asset.lastSeenAt) : "",
        lastLocation: asset.lastSeenLocation,
      });
    }

    sheet.autoFilter = { from: "A1", to: { row: 1, column: sheet.columnCount } };
    return workbookToBuffer(workbook);
  },
};

export type { StaffGroup, ReportPeriod };
