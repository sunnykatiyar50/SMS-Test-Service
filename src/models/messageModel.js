const { toIso } = require('../utils/time');

const COLUMNS = 'id, sender, phone, message, timestamp, api_key_name';

function toMessage(row) {
    return {
        id: Number(row.id),
        sender: row.sender,
        phone: row.phone,
        message: row.message,
        timestamp: toIso(row.timestamp),
        apiKeyName: row.api_key_name || null,
    };
}

class MessageModel {
    // db is the adapter returned by database/initDatabase.js
    constructor(db) {
        this.db = db;
    }

    buildFilters({ search, phone, from, to } = {}) {
        const clauses = [];
        const params = [];
        if (search) {
            clauses.push('(LOWER(message) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(sender) LIKE ?)');
            const like = `%${search.toLowerCase()}%`;
            params.push(like, like, like);
        }
        if (phone) {
            clauses.push('phone = ?');
            params.push(phone);
        }
        if (from) {
            clauses.push('timestamp >= ?');
            params.push(from);
        }
        if (to) {
            clauses.push('timestamp < ?');
            params.push(to);
        }
        return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
    }

    // Returns one page of messages (newest first) plus the total number of matches
    async list({ limit, offset, ...filters }) {
        if (!Number.isInteger(limit) || !Number.isInteger(offset)) {
            throw new TypeError('limit and offset must be integers');
        }
        const { where, params } = this.buildFilters(filters);
        const [countRow] = await this.db.all(`SELECT COUNT(*) AS total FROM messages ${where}`, params);
        // limit/offset are validated integers, so they are safe to inline (MySQL rejects them as bound params)
        const rows = await this.db.all(
            `SELECT ${COLUMNS} FROM messages ${where} ORDER BY timestamp DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
            params
        );
        return { total: Number(countRow.total), messages: rows.map(toMessage) };
    }

    async latest(filters) {
        const { messages } = await this.list({ ...filters, limit: 1, offset: 0 });
        return messages[0] || null;
    }

    async create({ sender, phone, message, apiKeyName }) {
        const timestamp = new Date();
        const id = await this.db.insert(
            'INSERT INTO messages (sender, phone, message, timestamp, api_key_name) VALUES (?, ?, ?, ?, ?)',
            [sender, phone, message, timestamp, apiKeyName || null]
        );
        return { id: Number(id), timestamp: timestamp.toISOString() };
    }

    // Deletes the given ids; returns the number of rows removed
    async deleteMany(ids) {
        if (ids.length === 0) return 0;
        const placeholders = ids.map(() => '?').join(', ');
        return this.db.run(`DELETE FROM messages WHERE id IN (${placeholders})`, ids);
    }

    async deleteOlderThan(date) {
        return this.db.run('DELETE FROM messages WHERE timestamp < ?', [date]);
    }

    async ping() {
        await this.db.all('SELECT 1 AS ok');
    }
}

module.exports = MessageModel;
