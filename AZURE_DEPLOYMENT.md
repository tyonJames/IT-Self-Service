# Azure deployment

Deployment target: **Azure App Service (Linux)**, **Azure Database for PostgreSQL
Flexible Server**, **Azure Blob Storage**, **Azure Key Vault** for secrets, **Azure
Cache for Redis** for lockout counters, **Application Insights** for telemetry.

This document is written so a competent IT administrator can follow it step by step. All
Azure CLI commands assume a modern `az` (`az login` and `az extension add --name
containerapp` beforehand). Substitute your own values wherever a variable looks like
`radx-…`.

Architecture at a glance:

```
                     Front Door / HTTPS
                              │
                              ▼
                    App Service (Linux)          ── Application Insights
                     Next.js standalone
                              │
       ┌────────────┬─────────┴─────────┬──────────────┐
       ▼            ▼                   ▼              ▼
  PostgreSQL   Blob Storage         Key Vault      Redis Cache
  Flexible     (uploads)          (secrets)      (throttles)
```

---

## 0 · Prerequisites

- An Azure subscription with permission to create resources.
- The Azure CLI (`az`) 2.60 or newer.
- The application source, pushed to a Git remote your pipeline can reach.
- A DNS name you can point at App Service.

Pick a region and stick to it, so every service reaches every other service without
egressing.

```bash
export LOCATION="southafricanorth"
export RG="radx-helpdesk"
export APP="radx-helpdesk"
export DB="radx-helpdesk-db"
export STORAGE="radxhelpdesk$(openssl rand -hex 3)"
export KV="radx-helpdesk-kv-$(openssl rand -hex 2)"
export APPI="radx-helpdesk-ai"
export REDIS="radx-helpdesk-redis"
```

---

## 1 · Resource group

```bash
az group create --name "$RG" --location "$LOCATION"
```

## 2 · PostgreSQL Flexible Server

```bash
export PGADMIN="radxadmin"
export PGPASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"

az postgres flexible-server create \
  --resource-group "$RG" \
  --name "$DB" \
  --location "$LOCATION" \
  --admin-user "$PGADMIN" \
  --admin-password "$PGPASS" \
  --sku-name Standard_B2s \
  --tier Burstable \
  --version 16 \
  --storage-size 32 \
  --high-availability Disabled \
  --backup-retention 14 \
  --public-access None
```

Record `$PGADMIN` and `$PGPASS`; put both in Key Vault in §7.

Create the application database:

```bash
az postgres flexible-server db create \
  --resource-group "$RG" --server-name "$DB" --database-name helpdesk
```

## 3 · Networking

**Option A — VNet integration (recommended).** Provision a VNet and delegate a subnet
to `Microsoft.Web/serverFarms`, then attach it to both the PostgreSQL server (§2 with
`--vnet …`) and the App Service (§6, "Set up VNet integration"). PostgreSQL never
becomes reachable from the internet.

**Option B — Private access + firewall.** If you cannot use a VNet, keep the server
on `--public-access None` and add firewall rules for the App Service outbound IPs (get
them with `az webapp show --query outboundIpAddresses`). Never open `0.0.0.0/0`.

Enable `require_secure_transport` on the server so PostgreSQL refuses plaintext
connections:

```bash
az postgres flexible-server parameter set \
  --resource-group "$RG" --server-name "$DB" \
  --name require_secure_transport --value on
```

## 4 · Storage account and container

```bash
az storage account create \
  --resource-group "$RG" --name "$STORAGE" --location "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2

az storage container create \
  --account-name "$STORAGE" \
  --auth-mode login \
  --name helpdesk-uploads \
  --public-access off
```

Blob public access is off at both the account and the container. Nothing the
application uploads should ever be reachable without going through the app.

## 5 · Application Insights

```bash
az extension add --name application-insights >/dev/null 2>&1 || true
az monitor app-insights component create \
  --resource-group "$RG" --app "$APPI" --location "$LOCATION" \
  --kind web --application-type web
export APPI_CONN="$(az monitor app-insights component show \
  --resource-group "$RG" --app "$APPI" --query connectionString -o tsv)"
```

## 6 · App Service

```bash
az appservice plan create \
  --resource-group "$RG" --name "${APP}-plan" \
  --location "$LOCATION" --is-linux --sku P0v3

az webapp create \
  --resource-group "$RG" --plan "${APP}-plan" --name "$APP" \
  --runtime "NODE:20-lts"

# Managed identity for Blob Storage and Key Vault access.
az webapp identity assign --resource-group "$RG" --name "$APP"
export PRINCIPAL="$(az webapp identity show --resource-group "$RG" --name "$APP" --query principalId -o tsv)"

az role assignment create \
  --assignee "$PRINCIPAL" \
  --role "Storage Blob Data Contributor" \
  --scope "$(az storage account show --resource-group "$RG" --name "$STORAGE" --query id -o tsv)"
```

Configure the startup command and let App Service run the standalone Next.js server.
The script applies migrations before serving traffic — a slot swap cannot leave the
database behind the code.

```bash
az webapp config set \
  --resource-group "$RG" --name "$APP" \
  --startup-file "node scripts/azure-startup.js" \
  --always-on true \
  --http20-enabled true \
  --min-tls-version 1.2 \
  --health-check-path "/api/health"
```

## 7 · Key Vault and application settings

```bash
az keyvault create \
  --resource-group "$RG" --name "$KV" --location "$LOCATION" \
  --enable-rbac-authorization true

az role assignment create \
  --assignee "$PRINCIPAL" \
  --role "Key Vault Secrets User" \
  --scope "$(az keyvault show --name "$KV" --query id -o tsv)"

# Add the secrets. Generate strong values.
SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
FIELD_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
JOB_TRIGGER_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
DATABASE_URL="postgresql://${PGADMIN}:${PGPASS}@${DB}.postgres.database.azure.com:5432/helpdesk?sslmode=require"

az keyvault secret set --vault-name "$KV" --name SECRET-KEY --value "$SECRET_KEY"
az keyvault secret set --vault-name "$KV" --name FIELD-ENCRYPTION-KEY --value "$FIELD_ENCRYPTION_KEY"
az keyvault secret set --vault-name "$KV" --name JOB-TRIGGER-SECRET --value "$JOB_TRIGGER_SECRET"
az keyvault secret set --vault-name "$KV" --name DATABASE-URL --value "$DATABASE_URL"
az keyvault secret set --vault-name "$KV" --name EMAIL-HOST-PASSWORD --value "<your SMTP password>"
```

## 8 · App Service configuration

Non-secret settings go directly; secret settings arrive as Key Vault references.
Replace `KV_NAME` with `$KV` when running these:

```bash
az webapp config appsettings set --resource-group "$RG" --name "$APP" --settings \
  NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  ALLOWED_HOSTS="helpdesk.radx.co.zw,${APP}.azurewebsites.net" \
  CSRF_TRUSTED_ORIGINS="https://helpdesk.radx.co.zw" \
  APP_BASE_URL="https://helpdesk.radx.co.zw" \
  PORT=8080 \
  STORAGE_PROVIDER=azure \
  AZURE_STORAGE_ACCOUNT="$STORAGE" \
  AZURE_STORAGE_CONTAINER=helpdesk-uploads \
  EMAIL_BACKEND=smtp \
  EMAIL_HOST="smtp.example.com" EMAIL_PORT=465 EMAIL_USE_SSL=True \
  EMAIL_HOST_USER="groupit@radxconstruction.com" \
  DEFAULT_FROM_EMAIL="Radx IT Help Desk <groupit@radxconstruction.com>" \
  IT_NOTIFY_EMAILS="groupit@radxconstruction.com" \
  SUPPORT_PHONE="+263 000 000 000" \
  SUPPORT_WHATSAPP="263000000000" \
  SUPPORT_EMAIL="it@radxconstruction.com" \
  WORK_DAY_START=8 WORK_DAY_END=17 WORK_DAYS="0,1,2,3,4" WORK_TIMEZONE="Africa/Harare" \
  SECURE_SSL_REDIRECT=True SECURE_HSTS_SECONDS=31536000 \
  RECYCLE_BIN_RETENTION_DAYS=30 \
  APPLICATIONINSIGHTS_CONNECTION_STRING="$APPI_CONN" \
  LOGIN_MAX_ATTEMPTS=5 LOGIN_LOCKOUT_SECONDS=900 \
  IP_MAX_ATTEMPTS=20 IP_LOCKOUT_SECONDS=900 \
  PASSWORD_MIN_LENGTH=12 \
  PASSWORD_RESET_MAX_PER_WINDOW=5 PASSWORD_RESET_WINDOW_SECONDS=900 \
  PUBLIC_FORM_MAX_PER_WINDOW=10 PUBLIC_FORM_WINDOW_SECONDS=3600

az webapp config appsettings set --resource-group "$RG" --name "$APP" --settings \
  SECRET_KEY="@Microsoft.KeyVault(VaultName=${KV};SecretName=SECRET-KEY)" \
  FIELD_ENCRYPTION_KEY="@Microsoft.KeyVault(VaultName=${KV};SecretName=FIELD-ENCRYPTION-KEY)" \
  JOB_TRIGGER_SECRET="@Microsoft.KeyVault(VaultName=${KV};SecretName=JOB-TRIGGER-SECRET)" \
  DATABASE_URL="@Microsoft.KeyVault(VaultName=${KV};SecretName=DATABASE-URL)" \
  EMAIL_HOST_PASSWORD="@Microsoft.KeyVault(VaultName=${KV};SecretName=EMAIL-HOST-PASSWORD)"
```

## 9 · Redis (once scaling past one instance)

```bash
az redis create --resource-group "$RG" --name "$REDIS" --location "$LOCATION" \
  --sku Basic --vm-size c0 --minimum-tls-version 1.2

REDIS_KEY=$(az redis list-keys --resource-group "$RG" --name "$REDIS" --query primaryKey -o tsv)
az keyvault secret set --vault-name "$KV" --name REDIS-URL \
  --value "rediss://:${REDIS_KEY}@${REDIS}.redis.cache.windows.net:6380"

az webapp config appsettings set --resource-group "$RG" --name "$APP" --settings \
  REDIS_URL="@Microsoft.KeyVault(VaultName=${KV};SecretName=REDIS-URL)"
```

Below one instance the in-process limiter is fine; the moment you scale out, lockouts
must live in a shared store. The app warns if `REDIS_URL` is empty in production.

## 10 · Custom domain and HTTPS

```bash
az webapp config hostname add --resource-group "$RG" --webapp-name "$APP" \
  --hostname helpdesk.radx.co.zw

az webapp config ssl create --resource-group "$RG" --name "$APP" \
  --hostname helpdesk.radx.co.zw

az webapp config ssl bind --resource-group "$RG" --name "$APP" \
  --certificate-thumbprint "<from previous>" --ssl-type SNI
```

Then in App Service → Configuration → General settings, set **HTTPS Only = On** and
**Minimum TLS = 1.2**.

## 11 · Deployment

Two supported paths, use one:

**Zip Deploy (from the CI pipeline).** `.github/workflows/azure-deploy.yml` builds the
standalone bundle and uses `azure/webapps-deploy@v3` — see §16.

**Docker image.** The repository includes a `Dockerfile` producing a hardened image.
Push to Azure Container Registry and set the App Service to run from that image.

Either way, the startup command remains `node scripts/azure-startup.js`.

## 12 · Database migrations

The startup script runs `prisma migrate deploy` before starting the server. If you
prefer to gate migrations behind an approval step:

```bash
export RADX_SEED_ON_START=false      # do this in App Settings
az webapp ssh --resource-group "$RG" --name "$APP" \
  --command "npx prisma migrate deploy"
```

## 13 · Seed and first administrator

Lookup tables (countries, ticket categories, equipment item types, one starter site per
country) are seeded by the startup script when `RADX_SEED_ON_START=true`, or by hand:

```bash
az webapp ssh --resource-group "$RG" --name "$APP" \
  --command "npx tsx prisma/seed.ts"
```

The first administrator is created interactively (no hard-coded production password):

```bash
az webapp ssh --resource-group "$RG" --name "$APP" \
  --command "npx tsx scripts/create-admin.ts"
```

## 14 · SMTP

The system uses `nodemailer` with a pooled SMTP connection. Set the SMTP server through
`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_SSL` and the two credentials. If you prefer Azure
Communication Services, its SMTP endpoint works with the same variables.

Every attempted email is recorded in `tickets_notification` with `pending`, `sent` or
`failed` and up to five automatic retries — see the log at
`/tickets/reports/notifications/`.

## 15 · Scheduled housekeeping

Azure App Service has no dependable cron, so the housekeeping job is an HTTP endpoint
protected by `JOB_TRIGGER_SECRET`. Wire it up with any of:

**Azure Function timer trigger (recommended).** A short Function calls the endpoint on
a schedule.

```javascript
module.exports = async function (context, timer) {
  const response = await fetch(
    `${process.env.APP_URL}/api/jobs/purge`,
    {
      method: "POST",
      headers: { "x-job-secret": process.env.JOB_TRIGGER_SECRET },
    },
  );
  context.log(await response.text());
};
```

Bind the two variables from the same Key Vault; run daily at 03:00 Africa/Harare
(`0 3 * * *` in cron, or NCRONTAB `0 0 1 * * *` in UTC).

**Logic App recurrence.** Recurrence trigger → HTTP action, method POST, URL
`https://helpdesk.radx.co.zw/api/jobs/purge`, header `x-job-secret` from Key Vault.

**Azure Web Job.** A tiny shell script bundled into `App_Data/jobs/triggered/purge/` with
a `settings.job` cron expression, invoking curl with the same header.

The job:

1. hard-deletes soft-deleted records past `RECYCLE_BIN_RETENTION_DAYS`, and their blobs,
2. removes expired sessions,
3. expires used and stale password-reset tokens,
4. retries failed notifications.

## 16 · CI/CD

`.github/workflows/azure-deploy.yml` runs on every push to `main`: `npm ci`, lint,
typecheck, tests against an ephemeral PostgreSQL, `next build`, package the standalone
bundle, deploy to App Service. The deploy step uses a federated identity — no publish
profile secret sits in the repo. Set the `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
`AZURE_SUBSCRIPTION_ID` GitHub secrets, and grant that Federated Credential the
`Website Contributor` role on the App Service.

## 17 · Health and monitoring

- Health check: `GET /api/health` — reports database and storage reachability.
  App Service uses it to decide which instance to route to.
- Application Insights collects requests, dependencies, exceptions and console output;
  query strings are stripped, so a reset token or job secret never lands in telemetry.
- Log stream: `az webapp log tail --resource-group "$RG" --name "$APP"`.
- Alerts: create rules on `requests/failed` (> 1% for 5 minutes), `exceptions/count`,
  and `performanceCounters/processCpuPercentage` (> 80% for 10 minutes).

## 18 · Backups

Azure Database for PostgreSQL Flexible Server takes automatic backups with the
retention chosen at creation (14 days above). Restore is point-in-time:

```bash
az postgres flexible-server restore \
  --resource-group "$RG" --name "${DB}-restore-$(date +%s)" \
  --source-server "$DB" --restore-time "2026-09-18T09:00:00Z"
```

Enable geo-redundant backup with `--geo-redundant-backup Enabled` at creation for a
critical-tier deployment. Blob Storage keeps 14 days of soft-delete + versioning if you
enable those on the account:

```bash
az storage account blob-service-properties update \
  --account-name "$STORAGE" \
  --enable-delete-retention true --delete-retention-days 14 \
  --enable-versioning true
```

## 19 · Rollback

Two safe paths:

- **Deployment slots.** Create a `staging` slot, deploy there, run smoke tests, then
  swap. Swap-back returns the previous build with no downtime.
- **Point-in-time database restore** (§18) if a migration went wrong. `prisma migrate
  resolve` marks a failed migration as rolled back so the next deploy re-applies it.

Never edit `.prisma_migrations` by hand outside `prisma migrate resolve`.

## 20 · Updating the application

1. Merge the change to `main`. CI runs lint, typecheck, tests, and the production build.
2. CI deploys to a `staging` slot.
3. Smoke test the staging slot (public forms, sign in, one ticket, one asset).
4. Swap `staging` and `production` — the startup script re-applies migrations before
   traffic reaches the swapped instance.
5. Watch the log stream and Application Insights for 15 minutes.

If something is wrong, swap back. The database migrations for a normal release are
additive; destructive changes are gated with a manual approval in CI.
