"use server";

import { revalidatePath } from "next/cache";
import { assertCsrf, CsrfError } from "@/lib/security/csrf";
import { requireAgent, ForbiddenError } from "@/lib/permissions";
import { clientIp } from "@/lib/security/request";
import { rateLimiter } from "@/lib/security/rate-limit";
import { env } from "@/lib/config/env";
import { importService, CsvImportError, type ImportReport } from "@/services/import.service";
import { filesFromFormData } from "@/lib/validation/common";
import { validateUpload, CSV_EXTENSIONS, UploadRejectedError } from "@/lib/security/uploads";
import { errorState, successState, type FormState } from "@/lib/utils/result";
import { SecurityEvent, securityLog, logger } from "@/lib/logging/logger";

/**
 * CSV import actions for assets and employees (instruction §21).
 *
 * Rate limited, because parsing a large CSV is the most expensive thing an
 * authenticated user can ask this application to do.
 */

async function runImport(
  kind: "assets" | "employees",
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCsrf(formData);
    const session = await requireAgent();

    const ip = await clientIp();
    const e = env();
    const limit = await rateLimiter().hit(
      `import:${kind}:${session.user.id}`,
      e.IMPORT_MAX_PER_WINDOW,
      e.IMPORT_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      securityLog(SecurityEvent.RATE_LIMITED, `${kind} import rate limited`, "WARNING", {
        userId: session.user.id,
        ip,
      });
      return errorState(
        `That is several imports in a short time. Wait about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      );
    }

    const [file] = filesFromFormData(formData, "file");
    if (!file) return errorState("Choose a CSV file to import.");

    const validated = await validateUpload(file, {
      allowedExtensions: CSV_EXTENSIONS,
      maxBytes: 5 * 1024 * 1024,
      // A CSV is plain text — there are no magic bytes to check.
      skipMagicCheck: true,
    });

    const content = validated.bytes.toString("utf8");
    const mode = String(formData.get("mode") ?? "upsert") === "create" ? "create" : "upsert";
    const dryRun = formData.get("dryRun") !== null;

    const report: ImportReport =
      kind === "assets"
        ? await importService.importAssets(session, content, { mode, dryRun })
        : await importService.importEmployees(session, content, { mode, dryRun });

    revalidatePath(kind === "assets" ? "/assets/" : "/employees/");

    const summary = dryRun
      ? `Rehearsal only — nothing was saved. ${report.created} would be created, ${report.updated} updated, ${report.skipped} skipped.`
      : `${report.created} created, ${report.updated} updated, ${report.skipped} skipped.`;

    return successState(summary, {
      totalRows: report.totalRows,
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      dryRun: report.dryRun,
      // Serialised so the report survives the trip back to the Client Component.
      issues: JSON.stringify(report.issues.slice(0, 200)),
      issueCount: report.issues.length,
    });
  } catch (error) {
    if (error instanceof CsrfError) return errorState(error.message);
    if (error instanceof ForbiddenError) return errorState(error.message);
    if (error instanceof UploadRejectedError) return errorState(error.message);
    if (error instanceof CsvImportError) return errorState(error.message);

    logger().error({ kind, err: (error as Error).message }, "CSV import failed");
    return errorState(
      "That import could not be completed and nothing was saved. Check the file and try again.",
    );
  }
}

export async function importAssetsCsv(_previous: FormState, formData: FormData): Promise<FormState> {
  return runImport("assets", formData);
}

export async function importEmployeesCsv(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runImport("employees", formData);
}
