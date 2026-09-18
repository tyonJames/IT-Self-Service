import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { storage } from "@/lib/storage";
import { env } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/**
 * `GET /api/health` — liveness and readiness (instruction §34).
 *
 * Returns 200 when the application can serve traffic and 503 when it cannot,
 * which is what Azure App Service health checks and Front Door probes act on.
 *
 * It deliberately exposes no connection strings, server names, versions or
 * error text: the response says *whether* a dependency is reachable, never
 * anything that would help someone attack it.
 */
export async function GET() {
  const checks: Record<string, "ok" | "degraded" | "failed"> = {};

  // Database — a trivial query, so the check measures reachability rather than
  // the speed of any particular table.
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "failed";
  }

  // Storage — a failure here does not stop the app serving pages, so it is
  // reported as degraded rather than failed.
  try {
    checks.storage = (await storage().healthy()) ? "ok" : "degraded";
  } catch {
    checks.storage = "degraded";
  }

  const healthy = checks.database === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "unhealthy",
      checks,
      environment: env().NODE_ENV,
      time: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
