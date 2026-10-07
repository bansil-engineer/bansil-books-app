# ============================================================
# Bansil Books — Production Dockerfile
# Phase 1: Single-instance Next.js + SQLite on Render
# Node 22 LTS (includes node:sqlite built-in)
#
# Security: starts as root for /app/data initialization only,
# then drops to unprivileged 'nextjs' user via su-exec.
# ============================================================

# -- Stage 1: Install dependencies --
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# -- Stage 2: Build the Next.js application --
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

# -- Stage 3: Production runtime --
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install su-exec for secure privilege drop (Alpine-native, minimal)
RUN apk add --no-cache su-exec

# Copy application files
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./

# Create data directory placeholder (overridden by Render persistent disk mount)
RUN mkdir -p /app/data

# Create non-root user (application runs as this user after privilege drop)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs && \
    chown -R nextjs:nodejs /app /app/data

# Copy and enable the entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# NOTE: No USER directive — container starts as root so the
# entrypoint can fix /app/data ownership on mounted volumes.
# Privileges are dropped to 'nextjs' immediately after.

# Next.js reads PORT from environment (Render sets this automatically)
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
