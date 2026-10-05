const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { logToFile } = require('../utils/logger');

// SQLite stores timestamps as ISO-8601 text, which sorts and compares correctly as strings
const toParam = value => (value instanceof Date ? value.toISOString() : value);

async function connect() {
    logToFile('Initializing SQLite database connection...');
    const db = await open({
        filename: process.env.SQLITE_PATH || './sms-db.sqlite',
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
    const columns = await db.all('PRAGMA table_info(messages)');
    if (!columns.some(c => c.name === 'api_key_name')) {
        await db.exec('ALTER TABLE messages ADD COLUMN api_key_name TEXT');
    }
    await db.exec('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)');

    return {
        dialect: 'sqlite',
        all: (sql, params = []) => db.all(sql, params.map(toParam)),
        run: async (sql, params = []) => (await db.run(sql, params.map(toParam))).changes,
        insert: async (sql, params = []) => (await db.run(sql, params.map(toParam))).lastID,
        close: () => db.close(),
    };
}

module.exports = connect;
