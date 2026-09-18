import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/config/env";

/**
 * Prisma client singleton.
 *
 * Prisma 7 runs on a driver adapter (node-postgres) with a WASM query
 * compiler, so there is no Rust engine process and connection pooling is the
 * `pg` pool's job. The pool size is kept modest because Azure Database for
 * PostgreSQL Flexible Server (Burstable/General Purpose tiers) has a low
 * max_connections and App Service may run several instances.
 *
 * In development the instance is cached on `globalThis` so Next.js hot reload
 * does not open a new pool on every edit.
 */

const globalForPrisma = globalThis as unknown as {
  __radxPrisma?: PrismaClient;
};

function create(): PrismaClient {
  const e = env();
  const adapter = new PrismaPg({
    connectionString: e.DATABASE_URL,
    max: e.isProduction ? 10 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: e.isProduction ? ["warn", "error"] : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.__radxPrisma ?? create();

if (!env().isProduction) {
  globalForPrisma.__radxPrisma = prisma;
}

/** Transaction client type — what services receive inside `$transaction`. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/** Either the singleton or an open transaction. Repositories accept this. */
export type Db = PrismaClient | Tx;
