import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 CLI configuration.
 *
 * Prisma 7 removed `url` from the datasource block: the CLI gets its
 * connection from here, the runtime client gets its own from
 * `src/lib/db/prisma.ts` (driver adapter). Both read DATABASE_URL, so there
 * is still exactly one place to configure the database.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
