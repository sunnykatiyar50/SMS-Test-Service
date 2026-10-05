const mysql = require('mysql2/promise');
const { logToFile } = require('../utils/logger');

async function connect() {
    logToFile('Initializing MySQL database connection...');
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        timezone: 'Z', // store and read DATETIME values as UTC
    });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender VARCHAR(255) NOT NULL,
            phone VARCHAR(32) NOT NULL,
            message TEXT NOT NULL,
            timestamp DATETIME(3) NOT NULL,
            INDEX idx_messages_timestamp (timestamp)
        )
    `);
    const [columns] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'api_key_name'`
    );
    if (columns.length === 0) {
        await pool.query('ALTER TABLE messages ADD COLUMN api_key_name VARCHAR(64)');
    }

    return {
        dialect: 'mysql',
        all: async (sql, params = []) => (await pool.query(sql, params))[0],
        run: async (sql, params = []) => (await pool.query(sql, params))[0].affectedRows,
        insert: async (sql, params = []) => (await pool.query(sql, params))[0].insertId,
        close: () => pool.end(),
    };
}

module.exports = connect;
