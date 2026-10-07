require('dotenv').config();

const { loadConfig } = require('./config');
const initializeDatabase = require('./database/initDatabase');
const MessageModel = require('./models/messageModel');
const ApiKeyModel = require('./models/apiKeyModel');
const { createApp } = require('./server');
const { logToFile } = require('./utils/logger');

const HOUR_MS = 60 * 60 * 1000;

function scheduleRetention(messageModel, retentionDays) {
    if (!retentionDays) return;
    const purge = async () => {
        try {
            const cutoff = new Date(Date.now() - retentionDays * 24 * HOUR_MS);
            const deleted = await messageModel.deleteOlderThan(cutoff);
            if (deleted) logToFile(`Retention: deleted ${deleted} message(s) older than ${retentionDays} day(s)`);
        } catch (error) {
            logToFile(`Retention cleanup failed: ${error.message}`);
        }
    };
    purge();
    setInterval(purge, HOUR_MS).unref();
}

async function main() {
    const config = loadConfig();
    if (config.authDisabled) {
        logToFile('WARNING: AUTH_DISABLED=true - the API and dashboard are open to anyone who can reach this server');
    }

    const db = await initializeDatabase();
    const messageModel = new MessageModel(db);
    // Dashboard-created API keys are encrypted with a key derived from SESSION_SECRET
    const apiKeyModel = new ApiKeyModel(db, { encryptionSecret: config.sessionSecret });
    const activeKeys = (await apiKeyModel.list()).filter(k => !k.revokedAt).length;
    if (!config.authDisabled && activeKeys === 0 && config.ingestApiKeys.length === 0) {
        logToFile('No API keys yet: sign in to the dashboard and create one on the API keys page');
    }
    scheduleRetention(messageModel, config.retentionDays);

    const app = createApp({ config, messageModel, apiKeyModel });
    const server = app.listen(config.port, () => {
        logToFile(`Server is running on http://localhost:${config.port}`);
    });
    handleShutdown(server, db);
}

// Stop accepting connections, let in-flight requests finish, then close the database.
// Without this, `docker stop` waits its full timeout and then kills the process.
function handleShutdown(server, db) {
    let shuttingDown = false;
    const shutdown = signal => {
        if (shuttingDown) return;
        shuttingDown = true;
        logToFile(`${signal} received, shutting down`);
        setTimeout(() => {
            logToFile('Shutdown timed out, exiting');
            process.exit(1);
        }, 8000).unref();
        server.close(async () => {
            try {
                await db.close();
            } catch (error) {
                logToFile(`Error closing database: ${error.message}`);
            }
            process.exit(0);
        });
        server.closeIdleConnections();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(error => {
    logToFile(`Startup failed: ${error.stack || error}`);
    process.exit(1);
});
