import "dotenv/config";

/**
 * Test environment.
 *
 * Integration tests run against TEST_DATABASE_URL, never the development
 * database — the value is copied into DATABASE_URL here, before any module
 * reads it, so a stray import cannot accidentally connect to real data.
 */
(process.env as Record<string, string>).NODE_ENV = "test";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Deterministic configuration for the SLA and security suites.
process.env.WORK_DAY_START ??= "8";
process.env.WORK_DAY_END ??= "17";
process.env.WORK_DAYS ??= "0,1,2,3,4";
process.env.WORK_TIMEZONE ??= "Africa/Harare";
process.env.SECRET_KEY ??= "test-secret-key-that-is-long-enough-for-the-tests-to-run-happily";
process.env.PASSWORD_MIN_LENGTH ??= "12";
process.env.EMAIL_BACKEND = "memory";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_LOCAL_ROOT ??= "./.storage-test";
process.env.REDIS_URL = "";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.RECYCLE_BIN_RETENTION_DAYS ??= "30";
