# Change Control Register

Per §38 of the build instruction: no requirement was silently changed. Each entry below
records the original requirement, why a change was necessary, what was implemented, and
the impact. Where no change was necessary the requirement was implemented verbatim, even
where it looks unusual (see CC-002).

---

## CC-001 — Authentication: NextAuth.js with database sessions

**Original requirement**
> "NextAuth.js for authentication" (spec §1); "Auth.js / NextAuth-compatible
> implementation … Database-backed session strategy where appropriate" (instruction §2).

**Reason change is necessary**
Auth.js v5 supports the database session strategy only for OAuth/Email providers. The
Credentials provider is hard-coded to the JWT strategy; `session.strategy = "database"`
is ignored for credentials logins. A stateless JWT cannot satisfy four requirements the
spec states explicitly: server-side revocation, 8-hour *sliding* expiry, session-key
cycling on login, and immediate logout-everywhere on role change or password reset.

**Proposed implementation (implemented)**
A DB-backed opaque-token session in `src/lib/auth/session.ts`, exposing an Auth.js-shaped
`Session` object via `auth()`:
- 256-bit CSPRNG token; only its SHA-256 digest is persisted in the `Session` table.
- Cookie `radx.session` (production: `__Host-radx.session`), `httpOnly`, `SameSite=Lax`,
  `Secure` in production, no `Max-Age` (dies on browser close).
- Sliding expiry: `expiresAt` extended to `now + SESSION_COOKIE_AGE` on any request more
  than 5 minutes past the last touch.
- Session cycling: all prior rows for the user are deleted on successful login.
- Revocation: `revokeAllForUser()` on role change, password reset and offboarding.

**Impact**
No behavioural loss; four requirements are met that the library route could not meet.
The session shape (`session.user.id`, `.email`, `.name`, `.role`) is Auth.js-compatible,
so migrating to a future Auth.js release that supports credentials + DB sessions is a
localised change inside `lib/auth/`. No page or service imports a session internal.

---

## CC-002 — SLA targets are inverted relative to convention

**Original requirement**
> `critical: 4 hours · high: 3 hours · medium: 2 hours · low: 1 hour` (spec §3.9,
> repeated in instruction §6).

**Observation, not a change**
Conventionally a *critical* ticket has the *shortest* target. As specified, a critical
ticket is given four working hours while a low ticket must be resolved in one. This is
almost certainly an error in the original Django system that the spec faithfully
reproduces — but it is stated twice, unambiguously, in both documents.

**Disposition: PRESERVED EXACTLY AS SPECIFIED.**
`SLA_TARGET_HOURS` in `src/lib/sla/sla.ts` carries the specified values, and the unit
tests assert them. The values are a single configuration object; if Radx confirms the
intent was `critical: 1, high: 2, medium: 3, low: 4`, changing that object and its test
is a two-line edit with no other code impact.

**Impact if changed later**
Historic `due_date` values already written to the database would not be recalculated.
`scripts/recalculate-sla.ts` is provided for that eventuality.

---

## CC-003 — Country code `ZA` vs `GR` for South Africa

**Original requirement**
> Ticket `country` enum: `ZW, MZ, NA, ZA, OTHER` (spec §3.9), while the Country lookup
> table and asset/equipment models use `GR`. Spec note 10 instructs mapping `ZA → GR`
> internally.

**Implementation**
`normaliseCountryCode()` in `src/lib/config/countries.ts` is applied at every service
boundary: `ZA` (and `RSA`, `ZA-GP`, case-insensitively) becomes `GR`. Only `GR` is ever
persisted. `ZA` remains accepted on input, including from the public forms and the CSV
importers, so nothing that previously submitted `ZA` breaks. Colour theming therefore has
exactly one code per country.

**Impact** None negative. Prevents the two-codes-one-country colour bug.

---

## CC-004 — Device key storage

**Original requirement**
> `device_key  string (64 char, indexed — secret token for agent auth)` (spec §3.4).

**Reason change is necessary**
The spec also requires (instruction §12) "Hash or otherwise securely protect device
authentication credentials where appropriate" and "A rotated key must immediately
invalidate the previous key". Storing a bearer token in plaintext in the assets table
means any read access to that table — a leaked backup, an over-broad report export, a SQL
injection elsewhere — yields working credentials for every tracked laptop.

**Proposed implementation (implemented)**
- The 64-character hex key is generated, returned to the enrolling agent **once**, and
  never stored in recoverable form.
- `Asset.deviceKeyHash` holds `SHA-256(key)`; `Asset.deviceKeyPrefix` holds the first 12
  characters, indexed, purely as a lookup selector so verification is one indexed row
  read plus one constant-time comparison rather than a table scan.
- Rotation overwrites both columns in a single statement, so the previous key stops
  working on the next request.

**Impact**
The wire protocol (`/device/enrol/`, `/device/report/`) is byte-identical to the spec, so
the existing PowerShell agent works unchanged. Operationally, a lost key cannot be looked
up — it must be rotated. This is the intended trade-off and is documented in
`docs/DEVICE_AGENT.md`.

---

## CC-005 — "8-hour session" and "expires at browser close" together

**Original requirement**
> `SESSION_COOKIE_AGE=28800` and `SESSION_EXPIRE_AT_BROWSER_CLOSE=True` (spec §7).

**Observation** These are in tension at the cookie layer: a cookie cannot both carry an
8-hour `Max-Age` and be a session cookie.

**Implementation**
Django resolves this by emitting a session cookie while keeping server-side expiry — the
same resolution is used here. The cookie carries no `Max-Age` (browser close ends it);
the `Session` row carries `expiresAt = now + SESSION_COOKIE_AGE`, slid forward on use.
Both environment variables remain meaningful and are honoured.

**Impact** None. Behaviour matches the Django original exactly.

---

## CC-006 — Field-encryption key fallback

**Original requirement**
> "Key from `FIELD_ENCRYPTION_KEY`; in dev, derived from `SECRET_KEY`; in production,
> refuses to use the fallback." (spec §6)

**Implementation** Implemented verbatim. `getFieldEncryptionKey()` derives an HKDF-SHA256
key from `SECRET_KEY` when `NODE_ENV !== "production"`, and throws
`FieldEncryptionKeyMissingError` at startup in production if `FIELD_ENCRYPTION_KEY` is
absent. Decryption failures (rotated key) are logged at WARN and return `""` rather than
throwing, exactly as specified.

**Impact** None — listed here only because the fallback is a deliberate, documented
weakening that is confined to non-production.

---

## CC-007 — `Ticket.assets` M2M alongside `Ticket.asset`

**Original requirement**
> `asset → Asset (nullable — the device this report is about)` **and**
> `assets → M2M Asset (related tickets)` (spec §3.9).

**Observation** Both are retained; they are not redundant. `asset` is the *subject* of the
report and drives the fault count behind the repair recommendation. `assets` is a set of
*additionally implicated* devices. The asset 360 view counts faults from `asset` only, so
that attaching a second device to a ticket does not inflate another asset's fault score.
This reading is stated here because the spec does not make the distinction explicit.

**Impact** None; documented to prevent a future "these look duplicated, delete one" change.

---

## CC-008 — Legacy asset category `computer`

**Original requirement**
> `(legacy "computer" kept for old records but hidden from dropdowns)` (spec §3.4).

**Implementation** `computer` exists in the `AssetCategory` enum and is rendered wherever
an existing record carries it, but is excluded from `SELECTABLE_ASSET_CATEGORIES`, which
is what every form dropdown iterates. The same treatment is applied to the deactivated
`phone` ticket category (`isActive = false`), which is seeded but not offered.

**Impact** None.
