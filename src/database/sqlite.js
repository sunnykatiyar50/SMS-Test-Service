const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { logToFile } = require('../utils/logger');

async function initializeDatabase() {
    logToFile('Initializing SQLite database connection...');
    const db = await open({
        filename: './sms-db.sqlite', // Path to your SQLite database file
        driver: sqlite3.Database,
    });

    await db.exec(
        `CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            phone TEXT NOT NULL,
            sender TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    );

    return db;
}

module.exports = initializeDatabase;