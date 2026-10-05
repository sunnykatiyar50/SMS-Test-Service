FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=30001 \
    DB_TYPE=sqlite \
    SQLITE_PATH=/app/data/sms-db.sqlite \
    LOG_DIR=/app/logs

# All dependencies are pure JavaScript (SQLite uses Node's built-in node:sqlite), so no build tools are needed
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# SQLite data and log files are written here; mount volumes to keep them
RUN mkdir -p /app/data /app/logs && chown -R node:node /app/data /app/logs
USER node

EXPOSE 30001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# The app handles SIGTERM itself (graceful shutdown); exec form keeps node as the signal receiver
CMD ["node", "src/app.js"]
