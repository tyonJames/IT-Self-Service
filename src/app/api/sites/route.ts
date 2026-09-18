import type { NextRequest } from "next/server";
import { lookupRepository } from "@/repositories/lookup.repository";
import { normaliseCountryCode } from "@/lib/config/countries";
import { fail, handleApiError, ok } from "@/lib/api/respond";
import { rateLimiter } from "@/lib/security/rate-limit";
import { clientIpFromHeaders } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * `GET /api/sites/?country=ZW` — powers the cascading Country → Site dropdown
 * on the public forms (spec §5.3).
 *
 * Public by necessity: the public forms need it before anyone signs in. It is
 * therefore kept to the minimum — id, name and short code of *active* sites in
 * one country, which is information already printed on the office door — and
 * rate limited so it cannot be used to enumerate the estate.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = clientIpFromHeaders(request.headers);
    const limit = await rateLimiter().hit(`api:sites:${ip}`, 120, 300);
    if (!limit.allowed) {
      return fail(429, "rate_limited", "Too many requests. Slow down and try again shortly.");
    }

    const raw = request.nextUrl.searchParams.get("country") ?? "";
    if (!raw.trim()) {
      return ok({ sites: [] });
    }

    const country = normaliseCountryCode(raw, "");
    if (!country) {
      // An unrecognised code is not an error — it just has no sites.
      return ok({ sites: [] });
    }

    const sites = await lookupRepository.sitesForCountry(country);

    return ok(
      { country, sites },
      200,
    );
  } catch (error) {
    return handleApiError(error, "GET /api/sites");
  }
}
