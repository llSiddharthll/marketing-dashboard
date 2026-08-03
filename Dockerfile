# Multi-stage build for Cloud Run.
#
# Three stages, each discarded except what the next one copies forward:
#   deps    installs node_modules (cached separately, so editing app code
#           doesn't force a reinstall)
#   builder runs the production build, including the vitest suite — a build
#           that fails its own tests never becomes a deployable image
#   runner  the actual container: just the standalone server output, running
#           as a non-root user
#
# Node 22 matches the version this project is developed and tested against.
# Alpine is safe here: nothing in package.json needs a native/glibc-only
# binary, so the smaller base costs nothing.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` for a reproducible install from the lockfile, not `npm install`.
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Fails the image build if a test regresses — a broken build should never
# reach Cloud Run.
RUN npm test
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# A dedicated, unprivileged user. The standalone server does not need root.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
# `standalone` intentionally omits static assets and public/, per Next's own
# docs — both are copied in explicitly, owned by the runtime user up front so
# there is no chown step at container start.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Cloud Run injects $PORT and expects the container to honour it; Next's
# standalone server.js already reads it.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
