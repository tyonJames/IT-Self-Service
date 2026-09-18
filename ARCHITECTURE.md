# Radx IT Help Desk — Architecture

**Version:** 1.0
**Stack:** Next.js 15 (App Router) · TypeScript (strict) · PostgreSQL 16 · Prisma 6 · Bootstrap 5.3.3
**Target:** Azure App Service (Linux) + Azure Database for PostgreSQL Flexible Server + Azure Blob Storage

---

## 1. Purpose

This document describes how the requirements in `radx-helpdesk-nextjs-prompt.md` (the
specification, hereafter "the spec") are realised in a Next.js/TypeScript application.
The spec was written against a Django implementation; every Django-specific construct has
been translated to its Next.js equivalent. The *behaviour* is preserved; the *mechanism* is not.

---

## 2. Layered architecture

```
┌───────────────────────────────────────────────────────────────┐
│  app/  — Routing, rendering, Server Actions, Route Handlers    │
│         (React Server Components by default)                   │
├───────────────────────────────────────────────────────────────┤
│  components/ — presentation only. No DB access, no auth logic. │
├───────────────────────────────────────────────────────────────┤
│  services/ — business rules, workflows, transactions,          │
│              authorisation enforcement, audit emission         │
├───────────────────────────────────────────────────────────────┤
│  repositories/ — Prisma query construction, soft-delete scopes,│
│                  pagination, selective field projection        │
├───────────────────────────────────────────────────────────────┤
│  lib/ — cross-cutting: auth, db, security, email, storage,     │
│         sla, validation, permissions, rate limiting, logging   │
├───────────────────────────────────────────────────────────────┤
│  PostgreSQL · Blob Storage · Redis · SMTP · App Insights       │
└───────────────────────────────────────────────────────────────┘
```

**Hard rules**

1. React components never import `@/lib/db`. Only services and repositories touch Prisma.
2. Every mutation entry point (Server Action or Route Handler) calls an authorisation
   helper *before* it calls a service, **and** the service re-checks object-level access.
   Middleware is a coarse first gate, never the only gate.
3. All input crossing a trust boundary is parsed with a Zod schema. The parsed object —
   never the raw `FormData`/JSON — is passed onward. This is the mass-assignment defence.
4. Multi-row writes go through `prisma.$transaction`.

---

## 3. Django → Next.js translation table

| Spec concept (Django)              | Implementation here                                                               |
|------------------------------------|-----------------------------------------------------------------------------------|
| Model                              | Prisma model in `prisma/schema.prisma`                                            |
| Migration                          | Prisma migration in `prisma/migrations/`                                          |
| `post_save` signal (profile create)| Explicit `userService.createUser()` inside a transaction                          |
| `post_save` signal (asset sync)    | `assetService.normaliseAssignment()` called by create/update, inside a transaction|
| `@login_required` / `@agent_required` | `requireAuthenticatedUser()`, `requireAgent()`, `requireAdmin()` in `lib/permissions` |
| Middleware                         | `src/middleware.ts` — security headers, HTTPS redirect, coarse route gating       |
| Context processor `support_contact`| `lib/config/support.ts`, read in the root layout (server-side)                    |
| Context processor `country_palette`| `lib/config/countries.ts` + CSS custom properties emitted in the root layout      |
| Custom manager / query scope       | Repository helpers: `notDeleted()` / `withDeleted()` filter builders              |
| Management command                 | `scripts/*.ts` run with `tsx`, plus a secret-protected HTTP trigger for Azure     |
| `FileField` + `MEDIA_ROOT`         | `StorageProvider` abstraction (`LocalStorageProvider` / `AzureBlobStorageProvider`)|
| URLconf                            | App Router file-system routes (see §5)                                            |
| DRF/JSON view                      | Route Handler (`route.ts`)                                                        |
| Template                           | Server Component (`page.tsx`) + Bootstrap markup                                  |
| Django session                     | DB-backed opaque-token session (see §6) exposing an Auth.js-shaped `Session`      |
| CSRF middleware                    | Double-submit token (`lib/security/csrf.ts`) + `SameSite=Lax` cookies             |
| `cache` (locmem/Redis) throttling  | `RateLimiter` abstraction: Redis in prod, in-process Map in dev/test              |
| Argon2 hasher                      | `@node-rs/argon2` (argon2id), PBKDF2-SHA256 verify-only fallback for legacy hashes|
| Fernet field encryption            | `lib/security/fernet.ts` — byte-compatible Fernet implementation over Node crypto |
| Gunicorn                           | `next start` behind Azure App Service, started by `scripts/azure-startup.js`      |
| WhiteNoise                         | Next.js static asset pipeline (`/_next/static`, immutable cache headers)          |
| `collectstatic`                    | `next build`                                                                      |
| Celery/cron purge                  | `/api/jobs/purge` protected by `JOB_TRIGGER_SECRET`, called by an Azure scheduler |

---

## 4. Directory layout

```
src/
├── app/
│   ├── (public)/            help, report, request-equipment  — no session required
│   ├── (app)/               dashboard, tickets, assets, employees, equipment, manage
│   ├── accounts/            login, logout, profile, users, password reset
│   ├── device/              enrol, report  (agent API, device-key auth)
│   └── api/                 sites, health, jobs, tickets, assets, employees, …
├── components/
│   ├── layout/  dashboard/  tickets/  assets/  employees/  equipment/  forms/  ui/
├── lib/
│   ├── auth/         session issue/verify/rotate, password hashing, lockout
│   ├── config/       env parsing (Zod), countries, support contact, work hours
│   ├── db/           Prisma client singleton
│   ├── email/        EmailProvider abstraction + SMTP provider
│   ├── logging/      structured logger + security audit events
│   ├── permissions/  role checks + object-level guards
│   ├── security/     csrf, fernet, headers, rate limit, upload validation, tokens
│   ├── sla/          working-hours engine
│   ├── storage/      StorageProvider abstraction
│   ├── utils/        pagination, formatting, result types
│   └── validation/   Zod schemas per module
├── services/         ticket, asset, employee, equipment, notification, device, user,
│                     lookup, recyclebin, report
├── repositories/     ticket, asset, employee, equipment, notification, device, lookup
└── types/            shared TS types and enums
```

---

## 5. Route map

Spec routes are preserved verbatim. Next.js rewrites are not used; the folder names match
the spec paths so that existing bookmarks, the PowerShell device agent, and printed QR
codes keep working.

| Spec URL | App Router file |
|---|---|
| `/help/` | `app/(public)/help/page.tsx` |
| `/report/` | `app/(public)/report/page.tsx` |
| `/report/sent/` | `app/(public)/report/sent/page.tsx` |
| `/request-equipment/` | `app/(public)/request-equipment/page.tsx` |
| `/request-equipment/sent/{id}/` | `app/(public)/request-equipment/sent/[id]/page.tsx` |
| `/api/sites/?country=` | `app/api/sites/route.ts` |
| `/device/enrol/` | `app/device/enrol/route.ts` |
| `/device/report/` | `app/device/report/route.ts` |
| `/tickets/`, `/tickets/{id}/` | `app/(app)/tickets/…` |
| `/tickets/reports/…` | `app/(app)/tickets/reports/…` |
| `/tickets/attachments/{id}/download/` | `app/(app)/tickets/attachments/[id]/download/route.ts` |
| `/assets/…`, `/employees/…`, `/equipment/…`, `/manage/…`, `/accounts/…` | mirrored 1:1 |
| `/api/health` | `app/api/health/route.ts` |
| `/api/jobs/purge` | `app/api/jobs/purge/route.ts` |

`trailingSlash: true` is set in `next.config.mjs` so `/tickets` and `/tickets/` both
resolve and canonicalise to the trailing-slash form the spec uses.

---

## 6. Session architecture (change-controlled — see §11, CC-001)

The spec asks for: 8-hour sliding expiry, expiry on browser close, `httpOnly` cookies,
session-key cycling on login, server-side revocation, and per-user lockout.

Auth.js v5's Credentials provider cannot use the database session strategy. Rather than
weaken the requirement to a stateless JWT, the app implements a DB-backed session that
exposes an Auth.js-shaped `Session` object through `auth()`:

- On login: a 256-bit random token is generated; only its SHA-256 digest is stored in the
  `Session` row. Any previous session rows for that user are deleted (session cycling).
- Cookie: `radx.session`, `httpOnly`, `sameSite=Lax`, `secure` in production, `__Host-`
  prefix in production, **no `Max-Age`** → the cookie dies with the browser.
- Sliding expiry: every authenticated request that is more than 5 minutes past the last
  touch extends `expiresAt` to `now + SESSION_COOKIE_AGE`. Expired rows are rejected and
  swept by the purge job.
- Revocation: deleting the row logs the user out everywhere, immediately. Role changes
  and password resets delete all of that user's sessions.

`auth()` is memoised per request with `React.cache`, so one DB read serves a whole render.

---

## 7. Authorisation model

Roles live on `UserProfile.role`: `staff` | `agent` | `admin`. Additionally
`User.isSuperuser` ⇒ admin and `User.isStaff` ⇒ at least agent (the spec's Django
superuser/is_staff rule).

```
requireAuthenticatedUser()  → Session            throws 401 redirect
requireAgent()              → Session            throws 403
requireAdmin()              → Session            throws 403
canViewTicket(session, t)   → boolean            staff: own tickets only
canModifyTicket(session, t) → boolean            agent/admin only
assertCanViewTicket(...)    → void | throws
```

Staff "own tickets" means `createdBy = me` **or** `submitterEmail = my email` **or**
`employee.user = me`. Staff never see internal comments, notification logs, other users'
tickets, assets, employees, or any `/manage/` page.

Object IDs arriving from the client are *never* trusted: every fetch-by-id is followed by
an ownership assertion, which is the IDOR defence. Role fields are never bound from
request bodies; role changes have their own admin-only action with a self-demotion guard.

---

## 8. Data access & soft delete

Four entities are soft-deletable: `Asset`, `Employee`, `Ticket`, `EquipmentRequest`.

```ts
notDeleted()            // { isDeleted: false }   — the default in every repository
withDeleted()           // {}                     — recycle bin only
softDelete(id, userId)  // sets isDeleted, deletedAt, deletedBy
restore(id)             // clears them
daysUntilPurge(record)  // max(0, 30 - elapsed days)
```

Repositories expose no method that forgets the scope: the "list" methods hard-code
`notDeleted()`, and only `recycleBinRepository` uses `withDeleted()`.

---

## 9. Key domain mechanisms

- **Ticket reference** — `RDX-{id:0>4}` derived from the PostgreSQL `BIGSERIAL` primary
  key. Concurrency safety is free: the sequence guarantees uniqueness without locking.
- **SLA** — `lib/sla/workhours.ts`: `addWorkingHours`, `workingHoursBetween`,
  `humaniseDuration`, `median`, all in `Africa/Harare`, Mon–Fri 08:00–17:00, configurable.
- **Asset assignment** — employee XOR site, enforced by a Postgres `CHECK` constraint
  *and* by `assetService.normaliseAssignment()` which syncs `assignedToName`,
  `assignedToUser`, and `department`.
- **Asset tag decoding** — `lib/utils/asset-tag.ts` parses `RDX-{country}{type}{seq}` and
  `tagMismatch()` returns a human-readable discrepancy for the data-health page.
- **Equipment request state machine** — `lib/workflow/equipment-status.ts` holds the
  transition map; `equipmentService.applyStatus()` validates and throws
  `InvalidTransitionError` on anything not in the map. The UI renders buttons *from* the
  same map, so UI and server can never disagree.
- **Notifications** — no fire-and-forget email. `notificationService.enqueue()` writes a
  `Notification` row (`pending`) inside the caller's transaction, then `dispatch()` sends
  and records `sent`/`failed` with `attempts` and `lastError`. Max 5 attempts.

---

## 10. Rendering strategy

Server Components by default. Client Components (`"use client"`) are used only for:
Bootstrap JS interop (collapse/modal/dropdown), Chart.js canvases, the cascading
country→site selector, drag-and-drop file inputs, the grid/table view toggle, the
password-reveal control, and filter forms that need debounced input.

All list pages are server-rendered with server-side filtering, sorting and pagination
(`LIMIT`/`OFFSET` with an indexed `ORDER BY`). No page ships an unfiltered dataset.

Every route segment that can fail or be slow has `loading.tsx` and `error.tsx`; the app
root has `not-found.tsx`.

---

## 11. Change-control register

Per §38 of the build instruction, nothing was silently changed. Full detail is in
`docs/CHANGE_CONTROL.md`. Summary:

| ID | Requirement | Disposition |
|----|-------------|-------------|
| CC-001 | "NextAuth.js" + database sessions + credentials | Auth.js-*compatible* custom DB session. Behaviour preserved and strengthened. |
| CC-002 | SLA targets (critical 4h … low 1h) | **Preserved exactly as specified**, despite being inverted from convention. Flagged, not changed. |
| CC-003 | Ticket `country` includes `ZA`; Country table uses `GR` | `ZA` accepted on input, normalised to `GR` at the service boundary. Spec note 10. |
| CC-004 | `device_key` stored as plain 64-char string | Stored as a SHA-256 digest + short lookup prefix. Security-driven; enrolment response is unchanged. |
| CC-005 | "Session expires on browser close" + "8-hour age" | Session cookie (no Max-Age) + 8h server-side sliding expiry. Both behaviours delivered. |
| CC-006 | `SECRET_KEY`-derived encryption key in dev | Kept, and production still refuses the fallback. |

---

## 12. Testing strategy

- **Unit** (`tests/unit`) — working hours across weekends/holidays/boundaries, SLA due
  dates, `humaniseDuration`, `median`, asset-tag parse + mismatch, repair recommendation,
  equipment transition matrix (exhaustive: all 49 from×to pairs), permission helpers,
  Zod schemas, Fernet round-trip, CSRF tokens.
- **Integration** (`tests/integration`) — run against a real PostgreSQL schema: ticket
  creation with SLA, assignment, comments with internal visibility, asset assignment
  exclusivity, soft delete/restore/purge, equipment workflow, auth + lockout, file
  permission checks.
- **E2E** (`tests/e2e`, Playwright) — public ticket submission, public equipment request,
  agent ticket management, asset creation, employee creation, equipment approval,
  login/logout, password reset.

---

## 13. Observability

`lib/logging/logger.ts` emits structured JSON to stdout (Azure App Service captures it),
plus the spec's `[timestamp] SECURITY LEVEL message` line for security events so existing
log greps keep working. Application Insights is initialised in `instrumentation.ts` when
`APPLICATIONINSIGHTS_CONNECTION_STRING` is present. Secrets, tokens, device keys and
passwords are redacted by an explicit allow-list serialiser — never by hoping.
