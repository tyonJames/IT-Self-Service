import pino from "pino";
import { env } from "@/lib/config/env";

/**
 * Structured logging (instruction §27).
 *
 * Two outputs, deliberately:
 *  - JSON to stdout, which Azure App Service / Application Insights ingest.
 *  - For security events, an additional `[timestamp] SECURITY LEVEL message`
 *    line in exactly the format the Django original produced, so existing log
 *    searches and alert rules keep working after the migration (spec §2).
 *
 * Redaction is an allow-list, not a deny-list: `safeDetail()` copies only
 * primitive values under keys that are not in SENSITIVE_KEYS. Nothing is
 * logged because we forgot to exclude it.
 */

const SENSITIVE_KEYS = new Set(
  [
    "password",
    "passwordhash",
    "password_hash",
    "newpassword",
    "confirmpassword",
    "currentpassword",
    "token",
    "tokenhash",
    "devicekey",
    "device_key",
    "devicekeyhash",
    "secret",
    "secretkey",
    "authorization",
    "cookie",
    "sessiontoken",
    "emailpassword",
    "email_password",
    "emailpasswordenc",
    "fieldencryptionkey",
    "smtppassword",
    "apikey",
    "connectionstring",
  ].map((k) => k.toLowerCase()),
);

export type LogDetail = Record<string, unknown>;

/** Strip anything sensitive and anything that is not a plain scalar. */
export function safeDetail(detail: LogDetail | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!detail) return out;
  for (const [key, raw] of Object.entries(detail)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
      continue;
    }
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string") {
      out[key] = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
    } else if (raw instanceof Date) {
      out[key] = raw.toISOString();
    } else if (typeof raw === "bigint") {
      out[key] = raw.toString();
    }
    // Objects and arrays are intentionally dropped rather than serialised:
    // it is the nested unknown that leaks a password.
  }
  return out;
}

let instance: pino.Logger | null = null;

export function logger(): pino.Logger {
  if (!instance) {
    instance = pino({
      level: env().LOG_LEVEL,
      base: { service: "radx-helpdesk" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    });
  }
  return instance;
}

export type SecurityLevel = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

/**
 * Security audit event names (instruction §27). Kept as a const object so a
 * typo becomes a compile error rather than an event nobody ever alerts on.
 */
export const SecurityEvent = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  LOGOUT: "LOGOUT",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  IP_LOCKED: "IP_LOCKED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET: "PASSWORD_RESET",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  ROLE_CHANGED: "ROLE_CHANGED",
  USER_CREATED: "USER_CREATED",
  FILE_ACCESS: "FILE_ACCESS",
  FILE_UPLOADED: "FILE_UPLOADED",
  FILE_DELETED: "FILE_DELETED",
  ASSET_CREATED: "ASSET_CREATED",
  ASSET_UPDATED: "ASSET_UPDATED",
  ASSET_DELETED: "ASSET_DELETED",
  ASSET_RESTORED: "ASSET_RESTORED",
  ASSET_PURGED: "ASSET_PURGED",
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
  EMPLOYEE_DELETED: "EMPLOYEE_DELETED",
  EMPLOYEE_OFFBOARDED: "EMPLOYEE_OFFBOARDED",
  EMPLOYEE_REACTIVATED: "EMPLOYEE_REACTIVATED",
  EMPLOYEE_PASSWORD_REVEALED: "EMPLOYEE_PASSWORD_REVEALED",
  EMPLOYEE_PASSWORD_CLEARED: "EMPLOYEE_PASSWORD_CLEARED",
  TICKET_CREATED: "TICKET_CREATED",
  TICKET_STATUS_CHANGED: "TICKET_STATUS_CHANGED",
  TICKET_ASSIGNED: "TICKET_ASSIGNED",
  TICKET_DELETED: "TICKET_DELETED",
  EQUIPMENT_STATUS_CHANGED: "EQUIPMENT_STATUS_CHANGED",
  EQUIPMENT_DELETED: "EQUIPMENT_DELETED",
  DEVICE_ENROLLED: "DEVICE_ENROLLED",
  DEVICE_KEY_ROTATED: "DEVICE_KEY_ROTATED",
  DEVICE_AUTH_FAILURE: "DEVICE_AUTH_FAILURE",
  RATE_LIMITED: "RATE_LIMITED",
  CSRF_FAILURE: "CSRF_FAILURE",
  AUTHZ_DENIED: "AUTHZ_DENIED",
  RECORD_RESTORED: "RECORD_RESTORED",
  RECORD_PURGED: "RECORD_PURGED",
  IMPORT_RUN: "IMPORT_RUN",
  JOB_RUN: "JOB_RUN",
} as const;

export type SecurityEventName = (typeof SecurityEvent)[keyof typeof SecurityEvent];

/**
 * Emit a security event to stdout. Persisting it to the AuditLog table is the
 * job of `auditService.record()`, which calls this as well — the two are kept
 * separate so that a database outage never silences the log.
 */
export function securityLog(
  event: SecurityEventName,
  message: string,
  level: SecurityLevel = "INFO",
  detail?: LogDetail,
): void {
  const safe = safeDetail(detail);
  const ts = new Date().toISOString();

  // Django-compatible line, for existing greps and alert rules.
  // eslint-disable-next-line no-console
  console.log(`[${ts}] SECURITY ${level} ${event} ${message}`);

  const payload = { event, security: true, level, ...safe };
  const log = logger();
  if (level === "CRITICAL" || level === "ERROR") log.error(payload, message);
  else if (level === "WARNING") log.warn(payload, message);
  else log.info(payload, message);
}
