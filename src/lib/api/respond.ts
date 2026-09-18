import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError, UnauthenticatedError } from "@/lib/permissions";
import { InvalidTransitionError } from "@/lib/domain/equipment-status";
import { UploadRejectedError } from "@/lib/security/uploads";
import { CsrfError } from "@/lib/security/csrf";
import { DeviceAuthError } from "@/services/device.service";
import { logger } from "@/lib/logging/logger";

/**
 * Consistent JSON responses for Route Handlers (instruction §18).
 *
 * One shape for success, one for failure, and a single translator from
 * domain errors to status codes — so no handler has to remember that an
 * invalid workflow transition is a 409. Internal error text never reaches the
 * client; it goes to the log with a reference the user can quote.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/**
 * Map a thrown error to a response. Anything unrecognised becomes a 500 with
 * a generic message — never a stack trace, never a database error string.
 */
export function handleApiError(error: unknown, context: string): NextResponse {
  if (error instanceof ZodError) {
    return fail(
      422,
      "validation_error",
      "Some of the values sent are not valid.",
      error.issues.map((i) => ({ field: i.path.join(".") || "_", message: i.message })),
    );
  }

  if (error instanceof UnauthenticatedError) {
    return fail(401, "unauthenticated", error.message);
  }

  if (error instanceof ForbiddenError) {
    return fail(403, "forbidden", error.message);
  }

  if (error instanceof CsrfError) {
    return fail(403, "csrf_failed", error.message);
  }

  if (error instanceof DeviceAuthError) {
    return fail(401, "device_auth_failed", "Device authentication failed.");
  }

  if (error instanceof InvalidTransitionError) {
    return fail(409, "invalid_transition", error.message);
  }

  if (error instanceof UploadRejectedError) {
    return fail(422, "upload_rejected", error.message);
  }

  const reference = Math.random().toString(36).slice(2, 10);
  logger().error(
    { context, reference, err: (error as Error)?.message, stack: (error as Error)?.stack },
    "Unhandled API error",
  );

  return fail(
    500,
    "internal_error",
    `Something went wrong on our side. Quote reference ${reference} if you report this.`,
  );
}
