import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: transport security, security headers, CSRF cookie seeding,
 * and a coarse "is there a session cookie at all" gate.
 *
 * It runs on the Edge runtime and therefore has no database access. That is
 * deliberate: middleware answers "should this request even reach a page", and
 * every page and Server Action independently performs the real authorisation
 * check against the database (see lib/permissions). Middleware is never the
 * only gate — instruction §8.
 */

const SESSION_COOKIE = "radx.session";
const SESSION_COOKIE_PROD = "__Host-radx.session";
const CSRF_COOKIE = "radx.csrf";

/** Paths that never require a session. */
const PUBLIC_PREFIXES = [
  "/help",
  "/report",
  "/request-equipment",
  "/device",
  "/accounts/login",
  "/accounts/logout",
  "/accounts/help",
  "/accounts/password-reset",
  "/api/sites",
  "/api/health",
  "/api/jobs",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/static",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function applySecurityHeaders(response: NextResponse, isProduction: boolean, hstsSeconds: number): void {
  // Spec §6 — transport and framing.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );

  if (isProduction && hstsSeconds > 0) {
    response.headers.set(
      "Strict-Transport-Security",
      `max-age=${hstsSeconds}; includeSubDomains; preload`,
    );
  }

  // Bootstrap and Chart.js are bundled locally, so no external script origins
  // are needed. 'unsafe-inline' for styles is required by Bootstrap's own
  // inline style attributes (progress bars, country accent borders).
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const isProduction = process.env.NODE_ENV === "production";
  const forceHttps = ["1", "true", "yes", "on"].includes(
    (process.env.SECURE_SSL_REDIRECT ?? "").toLowerCase(),
  );
  const hstsSeconds = Number.parseInt(process.env.SECURE_HSTS_SECONDS ?? "31536000", 10) || 0;

  // --- HTTPS enforcement --------------------------------------------------
  // App Service terminates TLS, so the original scheme arrives in the header.
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  if (forceHttps && proto === "http") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    const redirect = NextResponse.redirect(url, 308);
    applySecurityHeaders(redirect, isProduction, hstsSeconds);
    return redirect;
  }

  // --- Host allow-list ----------------------------------------------------
  const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (isProduction && allowedHosts.length > 0) {
    const host = (request.headers.get("host") ?? "").split(":")[0]?.toLowerCase() ?? "";
    if (host && !allowedHosts.includes(host)) {
      return new NextResponse("Bad request", { status: 400 });
    }
  }

  // --- Coarse auth gate ---------------------------------------------------
  const sessionCookie =
    request.cookies.get(isProduction ? SESSION_COOKIE_PROD : SESSION_COOKIE)?.value ?? "";

  let response: NextResponse;

  if (!isPublic(pathname) && !sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/accounts/login/";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next();
  }

  // --- CSRF cookie seeding ------------------------------------------------
  // Pages cannot set cookies during render, so the double-submit token is
  // seeded here and read back by <CsrfField /> when a form is rendered.
  if (!request.cookies.get(CSRF_COOKIE)?.value) {
    response.cookies.set(CSRF_COOKIE, randomToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: "/",
    });
  }

  applySecurityHeaders(response, isProduction, hstsSeconds);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's static output and image optimiser.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
