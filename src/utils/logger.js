const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');
const logFile = path.join(logDir, 'app.log');

// Ensure logs directory exists
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Rotate log file daily: move previous log to logs/app-YYYY-MM-DD.log if date changed
function rotateLogFileIfNeeded() {
    if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        const lastModified = new Date(stats.mtime);
        const today = new Date();
        const lastDate = lastModified.toISOString().slice(0, 10);
        const todayDate = today.toISOString().slice(0, 10);
        if (lastDate !== todayDate) {
            const archiveFile = path.join(logDir, `app-${lastDate}.log`);
            fs.renameSync(logFile, archiveFile);
        }
    }
}

// Logging utility
function logToFile(message) {
    rotateLogFileIfNeeded();
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

module.exports = { logToFile };