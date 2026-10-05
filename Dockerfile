# --- Build stage: install production dependencies ---
# sqlite3 downloads a prebuilt binary during install and falls back to compiling from source
# (unusual CPU architectures, or a proxy that blocks GitHub downloads). The toolchain for that
# fallback lives only in this stage, so the final image stays small.
FROM node:24-slim AS deps

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Runtime stage ---
FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3006 \
    DB_TYPE=sqlite \
    SQLITE_PATH=/app/data/sms-db.sqlite \
    LOG_DIR=/app/logs

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# SQLite data and log files are written here; mount volumes to keep them
RUN mkdir -p /app/data /app/logs && chown -R node:node /app/data /app/logs
USER node

EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# The app handles SIGTERM itself (graceful shutdown); exec form keeps node as the signal receiver
CMD ["node", "src/app.js"]
