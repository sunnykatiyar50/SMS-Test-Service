const { Pool } = require('pg');
const { logToFile } = require('../utils/logger');
const { sslOptions } = require('./ssl');

// The model writes SQL with "?" placeholders; Postgres expects $1, $2, ...
function toPgPlaceholders(sql) {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
}

async function connect() {
    logToFile('Initializing PostgreSQL database connection...');
    const pool = new Pool({
        host: process.env.PG_HOST,
        port: process.env.PG_PORT,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        database: process.env.PG_DATABASE,
        ssl: sslOptions(process.env.PG_SSL, process.env.PG_SSL_CA),
    });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(255) NOT NULL,
            phone VARCHAR(32) NOT NULL,
            message TEXT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS api_key_name VARCHAR(64)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)');

    return {
        dialect: 'postgres',
        all: async (sql, params = []) => (await pool.query(toPgPlaceholders(sql), params)).rows,
        run: async (sql, params = []) => (await pool.query(toPgPlaceholders(sql), params)).rowCount,
        insert: async (sql, params = []) =>
            (await pool.query(`${toPgPlaceholders(sql)} RETURNING id`, params)).rows[0].id,
        close: () => pool.end(),
    };
}

module.exports = connect;
