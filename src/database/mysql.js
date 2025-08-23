const mysql = require('mysql2/promise');
const { logToFile } = require('../utils/logger');

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
});

async function initializeDatabase() {
    logToFile('Initializing MySQL database connection...');
    // Create messages table if it doesn't exist
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender VARCHAR(255),
            phone VARCHAR(32),
            message TEXT,
            timestamp DATETIME
        );
    `;
    const conn = await pool.getConnection();
    await conn.query(createTableQuery);
    conn.release();
    return pool;
}

module.exports = initializeDatabase;