FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3006 \
    DB_TYPE=sqlite \
    SQLITE_PATH=/app/data/sms-db.sqlite

# Install production dependencies first to make better use of the layer cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# SQLite data and log files are written here; mount volumes to keep them
RUN mkdir -p /app/data /app/logs && chown -R node:node /app/data /app/logs
USER node

EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/app.js"]
