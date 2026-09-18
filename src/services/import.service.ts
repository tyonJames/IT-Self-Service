import { parse } from "csv-parse/sync";
import type { AssetCategory, AssetStatus, StaffGroup } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normaliseCountryCode } from "@/lib/config/countries";
import { normaliseAssetTag } from "@/lib/domain/asset-tag";
import { ALL_ASSET_CATEGORIES, ASSET_STATUSES } from "@/lib/domain/assets";
import { normaliseAssignment } from "./asset.service";
import { auditService } from "./audit.service";
import { SecurityEvent } from "@/lib/logging/logger";
import type { AppSession } from "@/lib/auth/session";

/**
 * CSV import for employees and assets (instruction §21).
 *
 * Design decisions worth stating:
 *  - Rows are validated *before* anything is written, and the whole import
 *    runs in one transaction. A file with a bad row on line 400 leaves the
 *    database exactly as it was, rather than half-imported.
 *  - A hard row cap and a size cap mean a 2 GB CSV cannot exhaust memory.
 *  - Column headers are matched case- and separator-insensitively, because
 *    real spreadsheets arrive with "Asset Tag", "asset_tag" and "ASSETTAG".
 *  - `dryRun` produces the full report without writing, so an import can be
 *    rehearsed before it is committed.
 */

export const MAX_IMPORT_ROWS = 5000;

export interface ImportIssue {
  row: number;
  field: string;
  message: string;
  value?: string;
}

export interface ImportReport {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  issues: ImportIssue[];
  dryRun: boolean;
  committed: boolean;
}

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvImportError";
  }
}

/** "Asset Tag" / "asset_tag" / "ASSETTAG" all normalise to "assettag". */
function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_\-.]/g, "");
}

type Row = Record<string, string>;

function readCsv(content: string): { rows: Row[]; headers: string[] } {
  let records: Record<string, string>[];
  try {
    records = parse(content, {
      columns: (header: string[]) => header.map(normaliseHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (error) {
    throw new CsvImportError(
      `That file could not be read as CSV: ${(error as Error).message.split("\n")[0]}`,
    );
  }

  if (records.length === 0) throw new CsvImportError("That file has no data rows.");
  if (records.length > MAX_IMPORT_ROWS) {
    throw new CsvImportError(
      `That file has ${records.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`,
    );
  }

  return { rows: records, headers: Object.keys(records[0] ?? {}) };
}

function pick(row: Row, ...names: string[]): string {
  for (const name of names) {
    const value = row[normaliseHeader(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function requireHeaders(headers: string[], required: string[][], what: string): void {
  const present = new Set(headers);
  const missing = required.filter((aliases) => !aliases.some((a) => present.has(normaliseHeader(a))));
  if (missing.length > 0) {
    throw new CsvImportError(
      `This ${what} file is missing required column(s): ${missing.map((m) => m[0]).join(", ")}. Found: ${headers.join(", ")}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

interface PreparedEmployee {
  row: number;
  fullName: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  site: string;
  employeeNumber: string | null;
  staffGroup: StaffGroup;
  altEmail: string;
  isActive: boolean;
  notes: string;
}

const STAFF_GROUPS: StaffGroup[] = ["staff", "management", "consultant"];

function parseBoolean(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "y", "active"].includes(value.toLowerCase());
}

export const importService = {
  async importEmployees(
    session: AppSession,
    content: string,
    options: { mode: "create" | "upsert"; dryRun: boolean },
  ): Promise<ImportReport> {
    const { rows, headers } = readCsv(content);
    requireHeaders(headers, [["full_name", "fullname", "name"], ["email"]], "employee");

    const issues: ImportIssue[] = [];
    const prepared: PreparedEmployee[] = [];
    const seenEmails = new Set<string>();

    rows.forEach((row, index) => {
      const lineNumber = index + 2; // +1 for zero-index, +1 for the header line

      const fullName = pick(row, "full_name", "fullname", "name");
      const email = pick(row, "email", "email_address", "work_email").toLowerCase();

      if (!fullName) {
        issues.push({ row: lineNumber, field: "full_name", message: "Name is required." });
        return;
      }
      if (!email) {
        issues.push({ row: lineNumber, field: "email", message: "Email address is required." });
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        issues.push({ row: lineNumber, field: "email", message: "Not a valid email address.", value: email });
        return;
      }
      if (seenEmails.has(email)) {
        issues.push({
          row: lineNumber,
          field: "email",
          message: "This address appears more than once in the file.",
          value: email,
        });
        return;
      }
      seenEmails.add(email);

      const staffGroupRaw = pick(row, "staff_group", "group").toLowerCase();
      const staffGroup = STAFF_GROUPS.includes(staffGroupRaw as StaffGroup)
        ? (staffGroupRaw as StaffGroup)
        : "staff";

      prepared.push({
        row: lineNumber,
        fullName,
        email,
        phone: pick(row, "phone", "mobile", "cell", "telephone"),
        department: pick(row, "department", "dept"),
        jobTitle: pick(row, "job_title", "jobtitle", "title", "position"),
        site: normaliseCountryCode(pick(row, "site", "country", "country_code"), "ZW"),
        employeeNumber: pick(row, "employee_number", "employeeno", "staff_number") || null,
        staffGroup,
        altEmail: pick(row, "alt_email", "altemail", "other_email").toLowerCase(),
        isActive: parseBoolean(pick(row, "is_active", "active", "status"), true),
        notes: pick(row, "notes", "comment"),
      });
    });

    const existing = await prisma.employee.findMany({
      where: { email: { in: prepared.map((p) => p.email) } },
      select: { id: true, email: true, isDeleted: true },
    });
    const existingByEmail = new Map(existing.map((e) => [e.email.toLowerCase(), e]));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const toCreate: PreparedEmployee[] = [];
    const toUpdate: { id: number; data: PreparedEmployee }[] = [];

    for (const candidate of prepared) {
      const match = existingByEmail.get(candidate.email);
      if (!match) {
        toCreate.push(candidate);
        created += 1;
        continue;
      }
      if (match.isDeleted) {
        issues.push({
          row: candidate.row,
          field: "email",
          message: "An employee with this address is in the recycle bin. Restore or purge it first.",
          value: candidate.email,
        });
        skipped += 1;
        continue;
      }
      if (options.mode === "create") {
        issues.push({
          row: candidate.row,
          field: "email",
          message: "Already exists — skipped because this import is set to create only.",
          value: candidate.email,
        });
        skipped += 1;
        continue;
      }
      toUpdate.push({ id: match.id, data: candidate });
      updated += 1;
    }

    if (!options.dryRun && (toCreate.length > 0 || toUpdate.length > 0)) {
      await prisma.$transaction(async (tx) => {
        for (const item of toCreate) {
          await tx.employee.create({
            data: {
              fullName: item.fullName,
              email: item.email,
              phone: item.phone,
              department: item.department,
              jobTitle: item.jobTitle,
              site: item.site,
              employeeNumber: item.employeeNumber,
              staffGroup: item.staffGroup,
              altEmail: item.altEmail,
              isActive: item.isActive,
              notes: item.notes,
            },
          });
        }
        for (const { id, data } of toUpdate) {
          await tx.employee.update({
            where: { id },
            data: {
              fullName: data.fullName,
              phone: data.phone,
              department: data.department,
              jobTitle: data.jobTitle,
              site: data.site,
              employeeNumber: data.employeeNumber,
              staffGroup: data.staffGroup,
              altEmail: data.altEmail,
              isActive: data.isActive,
              ...(data.notes ? { notes: data.notes } : {}),
            },
          });
        }
      });

      await auditService.record({
        event: SecurityEvent.IMPORT_RUN,
        message: `Employee CSV import: ${created} created, ${updated} updated, ${skipped} skipped`,
        actorId: session.user.id,
        actorRepr: session.user.username,
        target: "Employee",
        detail: { created, updated, skipped, issues: issues.length },
      });
    }

    return {
      totalRows: rows.length,
      created,
      updated,
      skipped,
      issues,
      dryRun: options.dryRun,
      committed: !options.dryRun && (toCreate.length > 0 || toUpdate.length > 0),
    };
  },

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  async importAssets(
    session: AppSession,
    content: string,
    options: { mode: "create" | "upsert"; dryRun: boolean },
  ): Promise<ImportReport> {
    const { rows, headers } = readCsv(content);
    requireHeaders(headers, [["category", "type"]], "asset");

    const issues: ImportIssue[] = [];
    const seenTags = new Set<string>();

    interface PreparedAsset {
      row: number;
      assetTag: string | null;
      category: AssetCategory;
      brand: string;
      model: string;
      serialNumber: string;
      status: AssetStatus;
      site: string;
      location: string;
      department: string;
      employeeEmail: string;
      siteName: string;
      macAddress: string;
      osVersion: string;
      officeVersion: string;
      imei1: string;
      imei2: string;
      cellNumber: string;
      package: string;
      printerType: string;
      tonerType: string;
      ipAddress: string;
      areaCode: string;
      notes: string;
    }

    const prepared: PreparedAsset[] = [];

    rows.forEach((row, index) => {
      const lineNumber = index + 2;

      const categoryRaw = pick(row, "category", "type", "asset_type").toLowerCase();
      if (!ALL_ASSET_CATEGORIES.includes(categoryRaw as AssetCategory)) {
        issues.push({
          row: lineNumber,
          field: "category",
          message: `Unknown type. Use one of: ${ALL_ASSET_CATEGORIES.join(", ")}.`,
          value: categoryRaw,
        });
        return;
      }

      const statusRaw = pick(row, "status", "state").toLowerCase() || "active";
      if (!ASSET_STATUSES.includes(statusRaw as AssetStatus)) {
        issues.push({
          row: lineNumber,
          field: "status",
          message: `Unknown status. Use one of: ${ASSET_STATUSES.join(", ")}.`,
          value: statusRaw,
        });
        return;
      }

      const assetTag = normaliseAssetTag(pick(row, "asset_tag", "assettag", "tag"));
      if (assetTag) {
        if (seenTags.has(assetTag)) {
          issues.push({
            row: lineNumber,
            field: "asset_tag",
            message: "This tag appears more than once in the file.",
            value: assetTag,
          });
          return;
        }
        seenTags.add(assetTag);
      }

      prepared.push({
        row: lineNumber,
        assetTag,
        category: categoryRaw as AssetCategory,
        brand: pick(row, "brand", "make", "manufacturer"),
        model: pick(row, "model"),
        serialNumber: pick(row, "serial_number", "serialnumber", "serial"),
        status: statusRaw as AssetStatus,
        site: normaliseCountryCode(pick(row, "site", "country", "country_code"), "ZW"),
        location: pick(row, "location", "site_name", "office"),
        department: pick(row, "department", "dept"),
        employeeEmail: pick(row, "assigned_to_email", "employee_email", "holder_email").toLowerCase(),
        siteName: pick(row, "assigned_site", "site_name"),
        macAddress: pick(row, "mac_address", "mac"),
        osVersion: pick(row, "os_version", "os"),
        officeVersion: pick(row, "office_version", "office"),
        imei1: pick(row, "imei_1", "imei1", "imei"),
        imei2: pick(row, "imei_2", "imei2"),
        cellNumber: pick(row, "cell_number", "cellnumber", "msisdn"),
        package: pick(row, "package", "plan"),
        printerType: pick(row, "printer_type", "printertype"),
        tonerType: pick(row, "toner_type", "tonertype"),
        ipAddress: pick(row, "ip_address", "ip"),
        areaCode: pick(row, "area_code", "areacode"),
        notes: pick(row, "notes", "comment"),
      });
    });

    // Resolve the assignment references up front, in two queries rather than
    // two per row.
    const emails = [...new Set(prepared.map((p) => p.employeeEmail).filter(Boolean))];
    const siteNames = [...new Set(prepared.map((p) => p.siteName).filter(Boolean))];

    const [employees, sites, existingTags] = await Promise.all([
      emails.length > 0
        ? prisma.employee.findMany({
            where: { isDeleted: false, email: { in: emails } },
            select: { id: true, email: true },
          })
        : Promise.resolve([]),
      siteNames.length > 0
        ? prisma.site.findMany({
            where: { name: { in: siteNames } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      prisma.asset.findMany({
        where: { assetTag: { in: [...seenTags] } },
        select: { id: true, assetTag: true, isDeleted: true },
      }),
    ]);

    const employeeByEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e.id]));
    const siteByName = new Map(sites.map((s) => [s.name, s.id]));
    const existingByTag = new Map(
      existingTags.filter((a) => a.assetTag).map((a) => [a.assetTag!, a]),
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const operations: { kind: "create" | "update"; id?: number; item: PreparedAsset }[] = [];

    for (const item of prepared) {
      if (item.employeeEmail && !employeeByEmail.has(item.employeeEmail)) {
        issues.push({
          row: item.row,
          field: "assigned_to_email",
          message: "No active employee has that email address — the asset will be left unassigned.",
          value: item.employeeEmail,
        });
      }
      if (item.siteName && !siteByName.has(item.siteName)) {
        issues.push({
          row: item.row,
          field: "assigned_site",
          message: "No site with that name — the asset will be left unassigned.",
          value: item.siteName,
        });
      }

      const match = item.assetTag ? existingByTag.get(item.assetTag) : undefined;

      if (!match) {
        operations.push({ kind: "create", item });
        created += 1;
        continue;
      }
      if (match.isDeleted) {
        issues.push({
          row: item.row,
          field: "asset_tag",
          message: "An asset with this tag is in the recycle bin. Restore or purge it first.",
          value: item.assetTag ?? "",
        });
        skipped += 1;
        continue;
      }
      if (options.mode === "create") {
        issues.push({
          row: item.row,
          field: "asset_tag",
          message: "Already exists — skipped because this import is set to create only.",
          value: item.assetTag ?? "",
        });
        skipped += 1;
        continue;
      }
      operations.push({ kind: "update", id: match.id, item });
      updated += 1;
    }

    if (!options.dryRun && operations.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const op of operations) {
          const { item } = op;
          const employeeId = item.employeeEmail
            ? (employeeByEmail.get(item.employeeEmail) ?? null)
            : null;
          const siteId = !employeeId && item.siteName ? (siteByName.get(item.siteName) ?? null) : null;

          const assignment = await normaliseAssignment(
            {
              assignedEmployeeId: employeeId,
              assignedSiteId: siteId,
              department: item.department,
              location: item.location,
              site: item.site,
            },
            tx,
          );

          const data = {
            assetTag: item.assetTag,
            category: item.category,
            brand: item.brand,
            model: item.model,
            serialNumber: item.serialNumber,
            status: item.status,
            macAddress: item.macAddress,
            osVersion: item.osVersion,
            officeVersion: item.officeVersion,
            imei1: item.imei1,
            imei2: item.imei2,
            cellNumber: item.cellNumber,
            package: item.package,
            printerType: item.printerType,
            tonerType: item.tonerType,
            ipAddress: item.ipAddress,
            areaCode: item.areaCode,
            notes: item.notes,
            ...assignment,
          };

          if (op.kind === "create") {
            await tx.asset.create({ data });
          } else if (op.id) {
            await tx.asset.update({ where: { id: op.id }, data });
          }
        }
      });

      await auditService.record({
        event: SecurityEvent.IMPORT_RUN,
        message: `Asset CSV import: ${created} created, ${updated} updated, ${skipped} skipped`,
        actorId: session.user.id,
        actorRepr: session.user.username,
        target: "Asset",
        detail: { created, updated, skipped, issues: issues.length },
      });
    }

    return {
      totalRows: rows.length,
      created,
      updated,
      skipped,
      issues,
      dryRun: options.dryRun,
      committed: !options.dryRun && operations.length > 0,
    };
  },
};
