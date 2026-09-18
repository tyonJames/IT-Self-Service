import { z } from "zod";

/**
 * Environment parsing.
 *
 * Every configuration value the application reads is declared here, validated
 * once, and exported as a typed object. `process.env` is not read anywhere
 * else in `src/` — a missing or malformed setting fails loudly at startup
 * rather than as `undefined` three layers down at 2am.
 */

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === "") return fallback;
      return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
    });

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === "") return fallback;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    });

const csv = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === "") return fallback;
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  SECRET_KEY: z.string().default("insecure-development-secret-key-change-me-now"),
  ALLOWED_HOSTS: csv(["localhost", "127.0.0.1"]),
  CSRF_TRUSTED_ORIGINS: csv([]),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().default("postgresql://radx:radx@127.0.0.1:5432/radx_helpdesk"),

  EMAIL_BACKEND: z.enum(["smtp", "console", "memory"]).default("console"),
  EMAIL_HOST: z.string().default(""),
  EMAIL_PORT: int(465),
  EMAIL_USE_SSL: bool(true),
  EMAIL_HOST_USER: z.string().default(""),
  EMAIL_HOST_PASSWORD: z.string().default(""),
  DEFAULT_FROM_EMAIL: z.string().default("Radx IT Help Desk <groupit@radxconstruction.com>"),
  IT_NOTIFY_EMAILS: csv([]),

  REDIS_URL: z.string().default(""),

  STORAGE_PROVIDER: z.enum(["local", "azure"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().default("./.storage"),
  AZURE_STORAGE_ACCOUNT: z.string().default(""),
  AZURE_STORAGE_CONTAINER: z.string().default("helpdesk-uploads"),
  AZURE_STORAGE_CONNECTION_STRING: z.string().default(""),
  MAX_UPLOAD_BYTES: int(10 * 1024 * 1024),

  FIELD_ENCRYPTION_KEY: z.string().default(""),
  ADMIN_URL: z.string().default("secret-admin-path"),
  LOGIN_MAX_ATTEMPTS: int(5),
  LOGIN_LOCKOUT_SECONDS: int(900),
  IP_MAX_ATTEMPTS: int(20),
  IP_LOCKOUT_SECONDS: int(900),
  PASSWORD_MIN_LENGTH: int(12),
  PASSWORD_RESET_MAX_PER_WINDOW: int(5),
  PASSWORD_RESET_WINDOW_SECONDS: int(900),
  PASSWORD_RESET_TOKEN_TTL_SECONDS: int(3600),
  PUBLIC_FORM_MAX_PER_WINDOW: int(10),
  PUBLIC_FORM_WINDOW_SECONDS: int(3600),
  IMPORT_MAX_PER_WINDOW: int(5),
  IMPORT_WINDOW_SECONDS: int(3600),
  JOB_TRIGGER_SECRET: z.string().default(""),

  SESSION_COOKIE_AGE: int(28800),
  SESSION_EXPIRE_AT_BROWSER_CLOSE: bool(true),

  SUPPORT_PHONE: z.string().default("+263 000 000 000"),
  SUPPORT_WHATSAPP: z.string().default("263000000000"),
  SUPPORT_EMAIL: z.string().default("it@radxconstruction.com"),

  WORK_DAY_START: int(8),
  WORK_DAY_END: int(17),
  WORK_DAYS: csv(["0", "1", "2", "3", "4"]),
  WORK_TIMEZONE: z.string().default("Africa/Harare"),

  SECURE_SSL_REDIRECT: bool(false),
  SECURE_HSTS_SECONDS: int(31536000),

  GEOIP_ENDPOINT: z.string().default(""),
  GEOIP_TIMEOUT_MS: int(2500),

  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().default(""),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  RECYCLE_BIN_RETENTION_DAYS: int(30),
});

export type AppEnv = z.infer<typeof schema> & {
  isProduction: boolean;
  isTest: boolean;
  workDays: number[];
};

function build(): AppEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;
  const isProduction = value.NODE_ENV === "production";

  if (isProduction) {
    const fatal: string[] = [];
    if (value.SECRET_KEY.length < 50) {
      fatal.push("SECRET_KEY must be at least 50 characters in production.");
    }
    if (!value.FIELD_ENCRYPTION_KEY) {
      fatal.push(
        "FIELD_ENCRYPTION_KEY is required in production — the SECRET_KEY-derived fallback is refused (spec §6).",
      );
    }
    if (value.ALLOWED_HOSTS.length === 0) {
      fatal.push("ALLOWED_HOSTS must list at least one host in production.");
    }
    if (!value.JOB_TRIGGER_SECRET) {
      fatal.push("JOB_TRIGGER_SECRET is required in production to protect the scheduled-job endpoint.");
    }
    if (fatal.length > 0) {
      throw new Error(`Refusing to start in production:\n${fatal.map((f) => `  - ${f}`).join("\n")}`);
    }
  }

  const workDays = value.WORK_DAYS.map((d) => Number.parseInt(d, 10)).filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  );

  return {
    ...value,
    isProduction,
    isTest: value.NODE_ENV === "test",
    workDays: workDays.length > 0 ? workDays : [0, 1, 2, 3, 4],
  };
}

let cached: AppEnv | null = null;

export function env(): AppEnv {
  if (!cached) cached = build();
  return cached;
}

/** Test-only: force re-parse after mutating process.env. */
export function resetEnvCache(): void {
  cached = null;
}
