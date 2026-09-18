# syntax=docker/dockerfile:1.7
# ---- Radx IT Help Desk — production image -----------------------------------
# Multi-stage build.
#
#   deps        — install every dependency, including devDependencies for the build.
#   builder     — generate the Prisma client and produce the Next.js standalone bundle.
#   runner      — a slim runtime image with only what the standalone bundle needs.
#
# The final image runs as a non-root user, honours SIGTERM, exposes port 8080,
# and boots through scripts/azure-startup.js — the same startup path App Service
# uses, so what you run locally is what you deploy.
# ------------------------------------------------------------------------------

FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs --shell /usr/sbin/nologin radx

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

# Standalone bundle — a self-contained server with only the modules it needs.
COPY --from=builder --chown=radx:nodejs /app/.next/standalone ./
COPY --from=builder --chown=radx:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=radx:nodejs /app/public ./public

# Prisma CLI, schema and migrations are needed at runtime for `migrate deploy`.
# node_modules for the CLI comes from the deps stage; the standalone bundle
# does not include devDependencies.
COPY --from=builder --chown=radx:nodejs /app/prisma ./prisma
COPY --from=builder --chown=radx:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=radx:nodejs /app/scripts ./scripts
COPY --from=builder --chown=radx:nodejs /app/package.json ./package.json
COPY --from=deps    --chown=radx:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps    --chown=radx:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps    --chown=radx:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=deps    --chown=radx:nodejs /app/node_modules/dotenv ./node_modules/dotenv

USER radx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

# tini handles SIGTERM cleanly so container orchestrators can drain gracefully.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/azure-startup.js"]
