const { Pool } = require('pg');
const { logToFile } = require('../utils/logger');

const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
});

async function initializeDatabase() {
    logToFile('Initializing PostgreSQL database connection...');
    // Create messages table if it doesn't exist
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(255),
            phone VARCHAR(32),
            message TEXT,
            timestamp TIMESTAMPTZ
        );
    `;
    await pool.query(createTableQuery);
    return pool;
}

module.exports = initializeDatabase;