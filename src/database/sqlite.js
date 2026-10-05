const { DatabaseSync } = require('node:sqlite');
const { logToFile } = require('../utils/logger');

// Uses Node's built-in SQLite driver, so there is no native module to compile and the same
// node_modules works on Windows, WSL/Linux and in Docker.
//
// SQLite stores timestamps as ISO-8601 text, which sorts and compares correctly as strings.
// node:sqlite rejects undefined, so it becomes NULL.
const toParam = value => (value instanceof Date ? value.toISOString() : value === undefined ? null : value);

async function connect() {
    logToFile('Initializing SQLite database connection...');
    const db = new DatabaseSync(process.env.SQLITE_PATH || './sms-db.sqlite');

    db.exec(
        `CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            phone TEXT NOT NULL,
            sender TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    );
    const columns = db.prepare('PRAGMA table_info(messages)').all();
    if (!columns.some(c => c.name === 'api_key_name')) {
        db.exec('ALTER TABLE messages ADD COLUMN api_key_name TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)');

    const run = (sql, params) => db.prepare(sql).run(...params.map(toParam));

    return {
        dialect: 'sqlite',
        all: async (sql, params = []) => db.prepare(sql).all(...params.map(toParam)),
        run: async (sql, params = []) => Number(run(sql, params).changes),
        insert: async (sql, params = []) => Number(run(sql, params).lastInsertRowid),
        close: async () => db.close(),
    };
}

module.exports = connect;
