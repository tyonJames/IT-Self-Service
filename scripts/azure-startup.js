#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Azure App Service startup command — the Node equivalent of the Gunicorn
 * startup script the Django original used (spec §8).
 *
 * Set as the App Service **Startup Command**:
 *
 *     node scripts/azure-startup.js
 *
 * It does three things, in order:
 *   1. applies any pending Prisma migrations (`prisma migrate deploy`),
 *   2. seeds the lookup tables if they are empty (idempotent),
 *   3. starts the Next.js standalone server on the port App Service provides.
 *
 * Migrations run here rather than in the build so that a deployment slot swap
 * cannot leave the database behind the code. If a migration fails the process
 * exits non-zero and App Service keeps the previous instance serving — which
 * is the behaviour you want at 2am.
 */

const { spawnSync, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const run = (command, args, label) => {
  console.log(`\n[startup] ${label}…`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`[startup] ${label} failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
};

if (!process.env.DATABASE_URL) {
  console.error("[startup] DATABASE_URL is not set. Refusing to start.");
  process.exit(1);
}

run("npx", ["prisma", "migrate", "deploy"], "Applying database migrations");

if (process.env.RADX_SEED_ON_START === "true") {
  run("npx", ["tsx", "prisma/seed.ts"], "Seeding lookup tables");
}

const port = process.env.PORT || "8080";
console.log(`\n[startup] Starting Next.js on port ${port}`);

// `output: "standalone"` in next.config.mjs produces server.js; fall back to
// `next start` if the standalone bundle is not present.
const standalone = path.join(process.cwd(), ".next", "standalone", "server.js");
const child = fs.existsSync(standalone)
  ? spawn(process.execPath, [standalone], {
      stdio: "inherit",
      env: { ...process.env, PORT: port, HOSTNAME: "0.0.0.0" },
    })
  : spawn("npx", ["next", "start", "-p", port], {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

const forward = (signal) => {
  process.on(signal, () => {
    console.log(`[startup] Received ${signal}, shutting down.`);
    child.kill(signal);
  });
};
forward("SIGTERM");
forward("SIGINT");

child.on("exit", (code) => process.exit(code ?? 0));
