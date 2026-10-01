const initializeDatabase = require('../database/initDatabase');
const { logToFile } = require('../utils/logger');

class MessageModel {
    constructor() {
        this.db = null;
        this.init();
    }

    async init() {
        try {
            this.db = await initializeDatabase();
        } catch (error) {
            logToFile(`Database initialization failed: ${error.stack || error}`);
            console.error('Database initialization failed:', error);
        }
    }

    async getMessages({ search = '', startDate, endDate } = {}) {
        if (!this.db) throw new Error('Database not initialized');

        let query = 'SELECT * FROM messages WHERE 1=1';
        const params = [];

        if (search) {
            query += ' AND message LIKE ?';
            params.push(`%${search}%`);
        }
        if (startDate) {
            // Start of the day
            query += ' AND timestamp >= ?';
            params.push(startDate + ' 00:00:00');
        }
        if (endDate) {
            // End of the day (exclusive)
            // Add 1 day to endDate and use < next day 00:00:00
            let endDateObj = new Date(endDate);
            endDateObj.setDate(endDateObj.getDate() + 1);
            const nextDay = endDateObj.toISOString().split('T')[0];
            query += ' AND timestamp < ?';
            params.push(nextDay + ' 00:00:00');
        }
        query += ' ORDER BY timestamp DESC';

        // Detect if using SQLite or another DB
        if (typeof this.db.all === 'function') {
            // SQLite
            return this.db.all(query, params);
        } else {
            // Postgres or MySQL
            // Replace SQLite-style placeholders with $1, $2, ... for Postgres
            let pgQuery = query;
            let pgParams = params;
            if (this.db.query) {
                // Postgres uses $1, $2, ...
                let idx = 1;
                pgQuery = query.replace(/\?/g, () => `$${idx++}`);
                const result = await this.db.query(pgQuery, pgParams);
                return result.rows;
            } else {
                // MySQL
                const [rows] = await this.db.execute(pgQuery, pgParams);
                return rows;
            }
        }
    }

    async createMessage(data) {
        if (!this.db) throw new Error('Database not initialized');
        const { sender, phone, message, timestamp } = data;
        const ts = timestamp || new Date().toISOString();

        if (typeof this.db.run === 'function') {
            // SQLite
            return this.db.run(
                'INSERT INTO messages (sender, phone, message, timestamp) VALUES (?, ?, ?, ?)',
                [sender, phone, message, ts]
            );
        } else if (this.db.query) {
            // Postgres
            const query = 'INSERT INTO messages (sender, phone, message, timestamp) VALUES ($1, $2, $3, $4)';
            return this.db.query(query, [sender, phone, message, ts]);
        } else if (this.db.execute) {
            // MySQL
            const query = 'INSERT INTO messages (sender, phone, message, timestamp) VALUES (?, ?, ?, ?)';
            return this.db.execute(query, [sender, phone, message, ts]);
        } else {
            throw new Error('Unknown database interface');
        }
    }

    async deleteMessage(id) {
        if (!this.db) throw new Error('Database not initialized');
        logToFile(`Deleting msg with ID: ${id}`);

        if (typeof this.db.run === 'function') {
            // SQLite
            const query = 'DELETE FROM messages WHERE id = ?';
            const result = await this.db.run(query, [id]);
            return result.changes > 0; // Return true if a row was deleted
        } else if (this.db.query) {
            // Postgres
            const query = 'DELETE FROM messages WHERE id = $1';
            const result = await this.db.query(query, [id]);
            return result.rowCount > 0; // Return true if a row was deleted
        } else if (this.db.execute) {
            // MySQL
            const query = 'DELETE FROM messages WHERE id = ?';
            const [result] = await this.db.execute(query, [id]);
            return result.affectedRows > 0; // Return true if a row was deleted
        } else {
            throw new Error('Unknown database interface');
        }
    }
}

module.exports = new MessageModel();