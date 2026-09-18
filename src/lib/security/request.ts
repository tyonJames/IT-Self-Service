import { headers } from "next/headers";

/**
 * Request metadata helpers.
 *
 * Client IP is read from the proxy chain because the app always sits behind
 * Azure App Service / Front Door. `X-Forwarded-For` is attacker-controllable
 * when the app is exposed directly, so this is used for rate-limit keys and
 * audit records — never for authorisation.
 */

const IP_HEADERS = [
  "x-azure-clientip", // Azure Front Door
  "x-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
] as const;

export function clientIpFromHeaders(h: Headers): string {
  for (const name of IP_HEADERS) {
    const value = h.get(name);
    if (!value) continue;
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export async function clientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

export async function userAgent(): Promise<string> {
  const value = (await headers()).get("user-agent") ?? "";
  return value.slice(0, 400);
}
