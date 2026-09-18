# Radx IT Help Desk

The IT help desk and asset management system for Radx Construction — Next.js 15 (App Router)
+ TypeScript, PostgreSQL 16 + Prisma 7, Bootstrap 5.3.3. Deployed to Azure App Service
(Linux), Azure Database for PostgreSQL Flexible Server, and Azure Blob Storage.

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — layered architecture, the Django→Next.js
  translation register, route map, session design.
- **[SECURITY.md](SECURITY.md)** — the security model in one document.
- **[AZURE_DEPLOYMENT.md](AZURE_DEPLOYMENT.md)** — first deployment, day-to-day operations,
  rollback.
- **[docs/CHANGE_CONTROL.md](docs/CHANGE_CONTROL.md)** — every place this implementation
  deviates from the specification, with reasons.
- **[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)** — requirement × file × test matrix.

---

## Quick start

Prerequisites: Node.js 20 or newer, PostgreSQL 14 or newer, and a working `psql`.

```bash
git clone <this repo> radx-helpdesk
cd radx-helpdesk
npm install

# Create a `.env` from the template, then generate strong secrets.
cp .env.example .env
node -e "console.log('SECRET_KEY=' + require('crypto').randomBytes(48).toString('base64url'))" >> .env
node -e "console.log('FIELD_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64url'))" >> .env
node -e "console.log('JOB_TRIGGER_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))" >> .env

# Create the database, apply migrations, seed lookup tables.
createdb radx_helpdesk
npm run prisma:migrate
npm run db:seed

# Create the first administrator (interactive; never hard-coded).
npm run create:admin

npm run dev
```

Open http://localhost:3000 — signed-in staff land on the Command Centre dashboard,
everyone else lands on the public portal at `/help/`.

## Public portal

- **`/help/`** — the landing page for reporters and requesters.
- **`/report/`** — report an IT problem (no sign-in). Attachments, cascading
  Country → Site, honeypot + rate-limited, confirmation email if requested.
- **`/request-equipment/`** — request equipment (no sign-in).

## Staff area

- **`/tickets/reports/`** — Command Centre dashboard (post-login landing page).
- **`/tickets/`** — filterable ticket list with named tabs; Excel and PDF exports.
- **`/tickets/{id}/`** — full ticket view: comments (with an internal-note toggle),
  attachments (authenticated downloads), status, assignment, SLA badge.
- **`/assets/`** — the register in grid or table mode, with country tiles.
- **`/assets/{id}/`** — the 360° asset view: specs, faults, repair advice, tag mismatch,
  device tracking with an OpenStreetMap link per check-in, documents.
- **`/employees/`** — active/suspended lists, a data-health page, PDF and Excel
  email registers, CSV import.
- **`/employees/{id}/`** — the 360° employee view with masked temporary mailbox password.
- **`/equipment/`** — the request queue with a strict server-enforced state machine.
- **`/manage/…`** — CRUD for sites, ticket categories, equipment types, countries; the
  recycle bin with 30-day retention.
- **`/accounts/…`** — sign in, password reset, profile, admin-only user management.

## Device agent

- `POST /device/enrol/` — an agent registers a device by serial number and receives a
  64-character key. The key is returned once and is never stored in recoverable form;
  only its SHA-256 digest is kept.
- `POST /device/report/` — check-in from the agent, authenticated with the device key
  (`Authorization: Bearer …` or `device_key` in the body).

## Scheduled housekeeping

Azure App Service has no dependable cron, so the housekeeping job is exposed as
`POST /api/jobs/purge` and protected by `JOB_TRIGGER_SECRET`. See
[AZURE_DEPLOYMENT.md §15](AZURE_DEPLOYMENT.md) for wiring it up as an Azure Function
timer trigger, a Logic App recurrence, or a WebJob.

The job:

1. hard-deletes soft-deleted records past the retention window, and their blobs;
2. removes expired sessions;
3. expires used and stale password-reset tokens;
4. retries failed notifications up to their limit.

The same work is available by hand: `npm run purge:run`, `npm run notifications:retry`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server. |
| `npm run build` | Production build (uses `prisma generate` under the hood). |
| `npm run start` | Serve the built app on `$PORT`. |
| `npm run azure:start` | Migrate + optional seed + start — the App Service startup script. |
| `npm run typecheck` | Strict TypeScript check. |
| `npm run lint` | ESLint (Next.js preset). |
| `npm run test` | Vitest — unit and integration tests. |
| `npm run test:e2e` | Playwright end-to-end tests. |
| `npm run prisma:migrate` | Apply migrations (production-safe). |
| `npm run prisma:migrate:dev` | Apply migrations and create a new one in development. |
| `npm run db:seed` | Seed lookup tables. Idempotent. |
| `npm run create:admin` | Create the first administrator interactively. |
| `npm run purge:run` | Run the recycle-bin purge by hand. |
| `npm run notifications:retry` | Retry failed emails by hand. |

## Testing

`npm test` runs 339 unit and integration tests against a real PostgreSQL:

- **Unit** (`tests/unit`) — working-hours engine (spec note 3), SLA maths, asset-tag
  decoding, equipment-request state machine (all 49 from×to pairs), permission helpers,
  Fernet round-trip, upload validation, filename sanitisation, password policy,
  pagination, formatting, validation schemas.
- **Integration** (`tests/integration`) — ticket creation, status changes, SLA
  recalculation on priority change, assignment, comment visibility, staff scoping,
  soft delete; asset assignment exclusivity (both service and DB), employee offboarding,
  encrypted temporary password reveal (audited), device enrolment and key rotation,
  document storage; equipment request state machine end to end, notifications; sign
  in, lockout, session cycling, password reset lifecycle, user management with the
  self-demotion and last-admin guards; CSV imports for assets and employees with row
  reporting.

## Tech decisions worth pointing to

- **Prisma 7 with driver adapter + WASM query compiler**, so `next build` needs no
  Rust engine binary and Azure App Service pulls no engine at deploy time
  (`prisma/schema.prisma`, `src/lib/db/prisma.ts`).
- **DB-backed sessions built as an Auth.js-compatible layer** ([CC-001](docs/CHANGE_CONTROL.md)):
  Auth.js's Credentials provider is JWT-only and cannot give the server-side revocation,
  8-hour sliding expiry, session cycling and expiry-on-browser-close the spec requires.
- **`SLA_TARGET_HOURS` preserved verbatim from the specification** ([CC-002](docs/CHANGE_CONTROL.md)) —
  critical is 4h and low is 1h, inverted from convention but exactly as specified.
- **Device keys stored as SHA-256 digests plus a lookup prefix** ([CC-004](docs/CHANGE_CONTROL.md));
  the wire protocol is unchanged.

## Verifying an install

```bash
npm run typecheck
npm run test
npm run build
```

A green run means: strict TypeScript across the entire codebase, 339 tests against
PostgreSQL, and a production standalone build in `.next/standalone/`.
