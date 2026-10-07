const { toIso } = require('../utils/time');
const { generateApiKey, hashApiKey, keyPrefix, createKeyCipher } = require('../utils/apiKeys');

const LAST_USED_INTERVAL_MS = 60 * 1000; // write last_used_at at most once a minute per key

function toKey(row, messageCounts) {
    return {
        id: Number(row.id),
        name: row.name,
        scope: row.scope,
        prefix: row.key_prefix,
        source: row.source || 'dashboard', // 'dashboard', or 'env' when imported from INGEST_API_KEYS
        createdAt: toIso(row.created_at),
        lastUsedAt: toIso(row.last_used_at),
        revokedAt: toIso(row.revoked_at),
        messageCount: messageCounts.get(row.name) || 0,
    };
}

// API keys created in the dashboard. Each key is stored twice: a SHA-256 hash, used to check incoming
// requests, and an AES-256-GCM encrypted copy, used only to show the key in the dashboard again.
class ApiKeyModel {
    constructor(db, { encryptionSecret } = {}) {
        this.db = db;
        this.cipher = createKeyCipher(encryptionSecret);
        this.lastUsedWrites = new Map(); // key id -> time of the last last_used_at write
    }

    async messageCounts() {
        const rows = await this.db.all(
            'SELECT api_key_name AS name, COUNT(*) AS total FROM messages WHERE api_key_name IS NOT NULL GROUP BY api_key_name'
        );
        return new Map(rows.map(r => [r.name, Number(r.total)]));
    }

    // Active keys first (newest first), then revoked ones
    async list() {
        const [rows, counts] = await Promise.all([
            this.db.all('SELECT * FROM api_keys ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END, created_at DESC, id DESC'),
            this.messageCounts(),
        ]);
        return rows.map(row => toKey(row, counts));
    }

    async nameExists(name) {
        const rows = await this.db.all('SELECT id FROM api_keys WHERE LOWER(name) = LOWER(?)', [name]);
        return rows.length > 0;
    }

    // Returns the new key's metadata and the full key. `secret` is only given when importing an
    // existing key; otherwise a new one is generated.
    async create({ name, scope, secret = generateApiKey(scope), source = 'dashboard' }) {
        const createdAt = new Date();
        const id = await this.db.insert(
            `INSERT INTO api_keys (name, scope, key_hash, key_prefix, key_encrypted, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, scope, hashApiKey(secret), keyPrefix(secret), this.cipher.encrypt(secret), source, createdAt]
        );
        const [row] = await this.db.all('SELECT * FROM api_keys WHERE id = ?', [Number(id)]);
        return { key: toKey(row, new Map()), secret };
    }

    // The full key for display, or null when it can't be decrypted (SESSION_SECRET changed)
    async reveal(id) {
        const [row] = await this.db.all('SELECT * FROM api_keys WHERE id = ?', [id]);
        if (!row) return undefined;
        return { key: toKey(row, new Map()), secret: this.cipher.decrypt(row.key_encrypted) };
    }

    // Returns the revoked key's metadata, or undefined if there's no such key
    async revoke(id) {
        const changed = await this.db.run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [new Date(), id]);
        const [row] = await this.db.all('SELECT * FROM api_keys WHERE id = ?', [id]);
        if (!row) return undefined;
        return { key: toKey(row, new Map()), changed: changed > 0 };
    }

    // Imports INGEST_API_KEYS entries as Send keys, keeping their values so apps don't change.
    // Runs on every start and is idempotent: a key whose value is already stored, including one
    // revoked in the dashboard, is skipped, so revoking it sticks even if it's still in .env.
    // If its name is taken by a different key, it gets a suffix (name-2, name-3, ...).
    async importKeys(entries) {
        const imported = [];
        for (const { name, key } of entries) {
            const existing = await this.db.all('SELECT id FROM api_keys WHERE key_hash = ?', [hashApiKey(key)]);
            if (existing.length) continue;
            const base = (name || 'imported').slice(0, 60); // the column holds 64; leave room for a suffix
            let finalName = base;
            for (let n = 2; await this.nameExists(finalName); n += 1) finalName = `${base}-${n}`;
            await this.create({ name: finalName, scope: 'send', secret: key, source: 'env' });
            imported.push({ name, storedAs: finalName });
        }
        return imported;
    }

    // Looks up an active key by its value; returns { id, name, scope } or null
    async authenticate(presented) {
        if (typeof presented !== 'string' || !presented || presented.length > 512) return null;
        const [row] = await this.db.all(
            'SELECT id, name, scope FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
            [hashApiKey(presented)]
        );
        if (!row) return null;
        this.touch(Number(row.id));
        return { id: Number(row.id), name: row.name, scope: row.scope };
    }

    // Records when a key was last used, without a database write on every request
    touch(id) {
        const now = Date.now();
        if (now - (this.lastUsedWrites.get(id) || 0) < LAST_USED_INTERVAL_MS) return;
        this.lastUsedWrites.set(id, now);
        this.db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [new Date(now), id]).catch(() => {
            // best effort: a failed write only means a slightly stale "last used"
        });
    }
}

module.exports = ApiKeyModel;
