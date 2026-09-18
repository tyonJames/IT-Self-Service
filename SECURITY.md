# Security model

Every point below covers a specific requirement from spec §6 and instruction §§8–13, §22,
§27. Where a decision differs from convention or from the spec, [docs/CHANGE_CONTROL.md](docs/CHANGE_CONTROL.md)
explains why.

## Threat model in one paragraph

Radx people report and manage IT problems from Windows laptops and phones, across four
countries, behind various Wi-Fi networks and public IP addresses. The public portal is
reachable from anywhere on the internet. The device agent is a PowerShell script running
on unattended machines. The system holds employee contact details, device inventories,
allocation forms, and temporary mailbox passwords — none is a state secret, but a leak of
any of it damages trust and is an information-security incident. The threats we design
against are: credential theft (phishing, password reuse), account takeover through
brute force, IDOR by curious insiders, mass assignment through hand-crafted requests,
CSRF, XSS, upload-based RCE, session fixation, IP or session hijack through mixed HTTP,
data disclosure through overly-broad exports, and long-tail leakage of secrets into logs.

## Transport

- `SECURE_SSL_REDIRECT=True` in production; an `http` request behind an App Service TLS
  terminator is redirected to `https` in `src/middleware.ts`.
- HSTS with `max-age=31536000; includeSubDomains; preload`, added by the middleware only
  in production so a local dev browser is never pinned to HTTPS on localhost.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`,
  `X-Permitted-Cross-Domain-Policies: none`, `Permissions-Policy` denying camera,
  microphone, geolocation, payment, usb, and interest-cohort.
- A restrictive Content-Security-Policy: `default-src 'self'`, script-src `'self'`
  (Bootstrap and Chart.js are bundled locally so no external origins are needed),
  `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`, `base-uri 'self'`.

## Session and authentication

- **DB-backed opaque sessions.** The cookie value is a 256-bit CSPRNG token; only its
  SHA-256 digest is stored (`accounts_session.token_hash`). A dump of the sessions table
  does not yield working credentials. See [CC-001](docs/CHANGE_CONTROL.md).
- **Cookie flags.** `HttpOnly`, `SameSite=Lax`, `Secure` in production, `__Host-` prefix
  in production, no `Max-Age` (so it dies on browser close). The 8-hour sliding window
  lives on the server row and is extended by `auth()` on any request more than 5 minutes
  past the last touch — see [CC-005](docs/CHANGE_CONTROL.md).
- **Session cycling on login.** Every successful sign-in deletes any prior session for
  the same user before issuing a new one, defeating session fixation and enforcing one
  active session per account.
- **Argon2id passwords** at OWASP baseline cost, with a verify-only PBKDF2-SHA256 path
  for hashes migrated from the Django original. A successful sign-in through the legacy
  path rewrites the hash to Argon2id transparently.
- **Password policy** — 12 characters, common-password blocklist, not entirely numeric,
  not similar to the user's own name/email/username.
- **Lockout.** Two independent counters (both in Redis in production, in-process in
  development): per-username at 5 failures in 15 minutes, per-IP at 20 failures in 15
  minutes. Successful sign-in clears the username counter.
- **Timing.** A password is verified against a fixed dummy Argon2 hash when the account
  does not exist, so response time does not reveal which accounts are real. The failure
  message is identical for "wrong password" and "unknown user".
- **Password reset.** Single-use tokens, 1-hour expiry, throttled to 5 per 15 minutes per
  IP. Requests for unknown addresses report the same "if that address has an account …"
  message — the form is not an enumeration oracle. Completing a reset revokes every
  session for that user.
- **Revocation.** `revokeAllForUser()` is called on role change, password reset, disable,
  and offboarding, so those actions take effect on the target's next request rather than
  whenever their session happens to expire.

## Authorisation

- **Three-tier RBAC**: staff, agent, admin. A Django superuser is an admin, and an
  `is_staff` user is at least an agent, matching the spec's Django rule.
- **Server-side only.** Middleware is a coarse first gate that redirects unauthenticated
  requests. Every page and Server Action then re-checks: `requireAgent()` /
  `requireAdmin()` in `src/lib/permissions/`, and object-level `canViewTicket()` /
  `assertCanViewTicket()` inside the services.
- **IDOR.** Every fetch-by-id is paired with an ownership assertion before anything is
  rendered or acted upon. Staff-scoped list queries push the same rule into SQL so a list
  cannot return another user's ticket by mistake.
- **Mass assignment.** Every mutation runs input through a Zod schema, and the *parsed*
  object (never raw `FormData`) is what the service receives. `role` is absent from
  every user-facing profile schema; changing a role has its own admin-only action with a
  self-demotion guard and a last-active-administrator guard.
- **Admin self-demotion.** `assertNotSelfDemotion()` blocks an admin from stripping
  their own admin role. `changeRole()` additionally refuses to demote the only active
  administrator left, so the application can never lock everyone out of user management.
- **Internal notes.** `Comment.isInternal` is filtered out for staff at the render layer,
  and the comment action forces `isInternal=false` for anyone who is not an agent, so a
  hand-crafted POST from a staff user cannot post one either.

## Data-tampering defences

- **CSRF.** `SameSite=Lax` on the session cookie plus a double-submit token seeded in
  `radx.csrf` by middleware and echoed as `csrf_token` in every form; `assertCsrf()` in
  every Server Action verifies both. An Origin/Referer allow-list against
  `CSRF_TRUSTED_ORIGINS` is checked before token comparison.
- **Origin check.** Every state-changing endpoint refuses a request whose Origin or
  Referer is not in the trusted list — belt and braces against browser bugs that would
  let a `SameSite=Lax` cookie cross a boundary.
- **SQL injection.** Prisma parameterises every query. The two raw queries in the code
  base (data-health duplicate scan, integration-test truncate) use tagged template
  literals or a hard-coded table list; user input is never interpolated into SQL.
- **XSS.** React escapes text nodes by default. There are two `dangerouslySetInnerHTML`
  sites — the country palette CSS and the report emails' HTML body — both fed only from
  server-computed values, and email HTML runs through `escapeHtml()` before interpolation.
- **Rate limiting.** Public forms are limited per IP (10 per hour by default). API
  routes reachable without a session (`/api/sites`, `/device/enrol`, `/device/report`)
  are limited too. CSV imports are limited per user. Password resets are limited per IP
  (5 per 15 minutes).

## File handling

- **No public URLs.** Uploads are stored under `{prefix}/{recordId}/{randomHex}/{safeName}`
  in the local filesystem or in Azure Blob Storage. The blob container is never made
  public; the app streams bytes out of an authenticated route handler that checks
  permissions on every download. `Content-Disposition: attachment` is always set so a
  stored HTML or SVG cannot execute in the application's origin.
- **Filename sanitisation.** Directory-traversal, control characters and unsafe
  punctuation are stripped; the display name is never used as a path.
- **Validation.** Every upload goes through `validateUpload()`: extension against a
  per-model allow-list, declared MIME plausible for that extension, magic bytes matching
  the extension for formats we can cheaply probe, size against a 10 MB cap.
- **Ticket attachments** allow `.jpg .jpeg .png .gif .pdf .doc .docx .xls .xlsx .txt .zip`;
  asset documents allow `.pdf .jpg .jpeg .png`. CSV imports allow `.csv .txt` and skip
  the magic-byte probe because CSV has no header.
- **Azure Managed Identity** is preferred over hard-coded storage keys. Set
  `AZURE_STORAGE_ACCOUNT` and leave `AZURE_STORAGE_CONNECTION_STRING` blank; the
  provider picks up the App Service identity through `DefaultAzureCredential`.

## Field encryption

- Employee temporary mailbox passwords are stored as Fernet ciphertext (byte-compatible
  with Python's `cryptography.fernet`), encrypted with a 32-byte key from
  `FIELD_ENCRYPTION_KEY`. Production refuses to start without one; development derives
  one from `SECRET_KEY` through HKDF as a convenience. See [CC-006](docs/CHANGE_CONTROL.md).
- Decryption failures (rotated key, corrupt ciphertext) log a warning and return `""` —
  the employee page renders "unavailable" rather than crashing.
- The revealed plaintext exists only for the duration of the audited request; it never
  goes to a log line, an audit `detail`, an export, or a list projection.

## Device tracking

- The 64-character hex device key is generated at enrolment and returned to the agent
  **once**. Only its SHA-256 digest is stored (`Asset.deviceKeyHash`), together with a
  12-character `deviceKeyPrefix` for indexed lookup. Verification is one indexed row
  read plus one constant-time comparison. See [CC-004](docs/CHANGE_CONTROL.md).
- **Rotation** overwrites both columns in one statement, so the previous key stops
  working on the very next request. There is no way to recover the previous plaintext.
- Device keys never appear in a log line, an audit detail, an export, or an error
  message. The audit trail records who rotated a key and when, never the key itself.
- Public IP is taken from the connection, not from the body: a device cannot be trusted
  to report its own location.

## Audit trail

`securityLog()` writes the specification's `[timestamp] SECURITY LEVEL EVENT message`
line to stdout (so existing greps keep working) and a structured JSON line for
Application Insights. `auditService.record()` persists the same event to the `AuditLog`
table with actor, target, IP and a redacted detail object. The persist is best-effort so
that an audit failure never rolls back the operation it describes.

Events recorded include: `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`, `ACCOUNT_LOCKED`,
`IP_LOCKED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`,
`ROLE_CHANGED`, `USER_CREATED`, `FILE_ACCESS`, `FILE_UPLOADED`, `FILE_DELETED`,
`ASSET_CREATED`, `ASSET_UPDATED`, `ASSET_DELETED`, `ASSET_RESTORED`, `ASSET_PURGED`,
`EMPLOYEE_*`, `EMPLOYEE_PASSWORD_REVEALED`, `TICKET_*`, `EQUIPMENT_STATUS_CHANGED`,
`DEVICE_ENROLLED`, `DEVICE_KEY_ROTATED`, `DEVICE_AUTH_FAILURE`, `RATE_LIMITED`,
`CSRF_FAILURE`, `AUTHZ_DENIED`, `RECORD_RESTORED`, `RECORD_PURGED`, `IMPORT_RUN`,
`JOB_RUN`.

## Log-hygiene rules

`safeDetail()` on the logger is an *allow-list*: only primitive values under keys not in
the sensitive-keys set are copied. Nested objects are dropped rather than serialised —
nested unknowns are how passwords leak into logs. Never-logged keys include: `password`,
`passwordHash`, `token`, `tokenHash`, `deviceKey`, `deviceKeyHash`, `secret`, `secretKey`,
`authorization`, `cookie`, `sessionToken`, `emailPassword`, `emailPasswordEnc`,
`fieldEncryptionKey`, `smtpPassword`, `apiKey`, `connectionString`. Application
Insights telemetry additionally strips query strings from every URL, because reset
tokens and job secrets sit there.

## Secure error handling

- Every Server Action catches its errors and returns a `FormState` with a friendly
  message. Stack traces stay in the server log.
- Route handlers thread every error through `handleApiError()`, which maps domain
  errors to HTTP status codes (401 / 403 / 404 / 409 / 422 / 429), never leaks an error
  string to the client, and includes an 8-character reference the user can quote.
- The global `error.tsx` boundaries display a friendly message and Next.js's error
  `digest` for correlation.

## Recycle bin

Soft delete is universal for the four entities the spec calls out. Records are hidden
from every list, ticket queue, employee register, asset register, and report. The
recycle bin is the only path that queries deleted rows.

Purging is admin-only and permanent. The automatic 30-day purge runs from the scheduled
job (`/api/jobs/purge`, protected by `JOB_TRIGGER_SECRET`) — not from a cron process on
the web instance, so it works correctly under horizontal scaling and slot swaps. The job
also removes expired sessions and used or stale password-reset tokens.
