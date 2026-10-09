const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-keys-logs-'));
// A file database, so a second app instance with a different secret can open the same keys
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sms-keys-db-')), 'keys.sqlite');
process.env.SQLITE_PATH = dbFile;

const request = require('supertest');
const { loadConfig } = require('../src/config');
const initializeDatabase = require('../src/database/initDatabase');
const MessageModel = require('../src/models/messageModel');
const ApiKeyModel = require('../src/models/apiKeyModel');
const { createApp } = require('../src/server');
const { KEY_PATTERN } = require('../src/utils/apiKeys');

const ADMIN_TOKEN = 'admin-token-0123456789';
const ENV_KEY = 'env-ingest-key-0123456789';
const env = {
    INGEST_API_KEYS: `legacy:${ENV_KEY}`,
    ADMIN_TOKEN,
    ADMIN_PASSWORD: 'pw-for-tests',
    SESSION_SECRET: 's'.repeat(48),
};

let db;
let app;
const admin = r => r.set('Authorization', `Bearer ${ADMIN_TOKEN}`);
const createKey = async (name, scope) => {
    const res = await admin(request(app).post('/api/keys')).send({ name, scope });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
};
const sendWith = (key, phone = '15551110000', message = 'Your code is 424242') =>
    request(app).post('/api/messages').set('X-API-Key', key).send({ phone, message });

// Mirrors src/app.js: build the models, import INGEST_API_KEYS, create the app
async function buildApp(overrides = {}) {
    const config = loadConfig({ ...env, ...overrides });
    const apiKeyModel = new ApiKeyModel(db, { encryptionSecret: config.sessionSecret });
    const imported = await apiKeyModel.importKeys(config.ingestApiKeys);
    return { app: createApp({ config, messageModel: new MessageModel(db), apiKeyModel }), imported };
}

before(async () => {
    db = await initializeDatabase();
    ({ app } = await buildApp());
});

after(async () => {
    await db.close();
});

describe('managing keys', () => {
    test('creates a key, returns it once in full, and lists it without the secret', async () => {
        const { key, secret } = await createKey('checkout-app', 'send');
        assert.match(secret, KEY_PATTERN);
        assert.ok(secret.startsWith('sms_send_'));
        assert.equal(key.prefix, secret.slice(0, key.prefix.length));
        assert.equal(key.scope, 'send');

        const list = await admin(request(app).get('/api/keys'));
        assert.equal(list.status, 200);
        assert.equal(list.headers['cache-control'], 'no-store');
        const listed = list.body.keys.find(k => k.name === 'checkout-app');
        assert.ok(listed);
        assert.equal(JSON.stringify(list.body).includes(secret), false, 'the list must never contain secrets');
        assert.equal(list.body.adminTokenConfigured, true);
    });

    test('reveals a key again (copyable any time)', async () => {
        const { key, secret } = await createKey('reveal-me', 'read');
        const res = await admin(request(app).post(`/api/keys/${key.id}/reveal`));
        assert.equal(res.status, 200);
        assert.equal(res.body.secret, secret);
        assert.equal(res.headers['cache-control'], 'no-store');
    });

    test('INGEST_API_KEYS entries are imported as ordinary Send keys (same value, copyable)', async () => {
        const list = await admin(request(app).get('/api/keys'));
        const legacy = list.body.keys.find(k => k.name === 'legacy');
        assert.equal(legacy.source, 'env');
        assert.equal(legacy.scope, 'send');
        assert.equal(legacy.prefix, ENV_KEY.slice(0, 6));
        const res = await admin(request(app).post(`/api/keys/${legacy.id}/reveal`));
        assert.equal(res.body.secret, ENV_KEY);
    });

    test('stores only a hash and an encrypted copy, never the plain key', async () => {
        const { secret } = await createKey('at-rest', 'send');
        const rows = await db.all("SELECT * FROM api_keys WHERE name = 'at-rest'");
        assert.equal(Object.values(rows[0]).some(v => String(v).includes(secret)), false);
    });

    test('validates names and scopes', async () => {
        const bad = await admin(request(app).post('/api/keys')).send({ name: '', scope: 'admin' });
        assert.equal(bad.status, 400);
        assert.ok(bad.body.details.name);
        assert.ok(bad.body.details.scope);
        await createKey('unique-name', 'send');
        for (const name of ['unique-name', 'UNIQUE-NAME', 'legacy', 'dashboard']) {
            const dup = await admin(request(app).post('/api/keys')).send({ name, scope: 'send' });
            assert.equal(dup.status, 400, name);
            assert.match(dup.body.details.name, /already used/);
        }
    });

    test('only admins can manage keys', async () => {
        const { secret: readKey } = await createKey('nosy-reader', 'read');
        const { secret: sendKey } = await createKey('nosy-sender', 'send');
        assert.equal((await request(app).get('/api/keys')).status, 401);
        assert.equal((await request(app).get('/api/keys').set('Authorization', `Bearer ${readKey}`)).status, 401);
        assert.equal((await request(app).post('/api/keys').set('X-API-Key', sendKey).send({ name: 'x', scope: 'send' })).status, 401);
    });

    test('revealing with a session cookie needs the CSRF header', async () => {
        const { key } = await createKey('csrf-check', 'send');
        const login = await request(app).post('/auth/login').send({ username: 'admin', password: env.ADMIN_PASSWORD });
        const cookie = login.headers['set-cookie'][0].split(';')[0];
        assert.equal((await request(app).post(`/api/keys/${key.id}/reveal`).set('Cookie', cookie)).status, 403);
        const ok = await request(app).post(`/api/keys/${key.id}/reveal`).set('Cookie', cookie).set('X-Requested-With', 'fetch');
        assert.equal(ok.status, 200);
    });
});

describe('using keys', () => {
    test('a Send key can send but not read', async () => {
        const { secret } = await createKey('sender', 'send');
        const sent = await sendWith(secret);
        assert.equal(sent.status, 201);
        const read = await request(app).get('/api/messages').set('X-API-Key', secret);
        assert.equal(read.status, 403);
        assert.match(read.body.error, /Read key/);
    });

    test('a Send key also works as an Authorization: Bearer header, in any letter case', async () => {
        const { secret } = await createKey('bearer-sender', 'send');
        const post = auth => request(app).post('/api/messages').set('Authorization', auth).send({ phone: '15553330000', message: 'hi' });

        const sent = await post(`Bearer ${secret}`);
        assert.equal(sent.status, 201);
        const stored = await admin(request(app).get('/api/messages?phone=15553330000'));
        assert.equal(stored.body.messages[0].apiKeyName, 'bearer-sender');

        assert.equal((await post(`bearer ${secret}`)).status, 201);
        assert.equal((await post(`BEARER  ${secret} `)).status, 201);
        assert.equal((await post('Bearer wrong-key-0123456789')).status, 401);
        assert.equal((await post(`Basic ${secret}`)).status, 401);
        assert.equal((await post(`Bearer ${secret} extra`)).status, 401);
    });

    test('X-API-Key wins when both headers are sent', async () => {
        const { secret: sendKey } = await createKey('header-wins', 'send');
        const res = await request(app)
            .post('/api/messages')
            .set('X-API-Key', sendKey)
            .set('Authorization', 'Bearer something-else-0123456789')
            .send({ phone: '15553340000', message: 'hi' });
        assert.equal(res.status, 201);
    });

    test('a Read key can list and fetch the latest message, but not send or delete', async () => {
        const { secret: sendKey } = await createKey('otp-sender', 'send');
        const { secret: readKey } = await createKey('e2e-tests', 'read');
        await sendWith(sendKey, '15552220000', 'Your code is 135790');

        const latest = await request(app).get('/api/messages/latest?phone=15552220000').set('Authorization', `Bearer ${readKey}`);
        assert.equal(latest.status, 200);
        assert.equal(latest.body.code, '135790');
        assert.equal((await request(app).get('/api/messages').set('X-API-Key', readKey)).status, 200);

        const send = await sendWith(readKey);
        assert.equal(send.status, 403);
        assert.match(send.body.error, /Send key/);
        assert.equal((await request(app).delete(`/api/messages/${latest.body.id}`).set('Authorization', `Bearer ${readKey}`)).status, 401);
    });

    test('messages record which key sent them, and keys count their messages', async () => {
        const { key, secret } = await createKey('counted', 'send');
        await sendWith(secret, '15553330000');
        await sendWith(secret, '15553330000');
        const list = await admin(request(app).get('/api/keys'));
        assert.equal(list.body.keys.find(k => k.id === key.id).messageCount, 2);
        const latest = await admin(request(app).get('/api/messages/latest?phone=15553330000'));
        assert.equal(latest.body.apiKeyName, 'counted');
    });

    test('records when a key was last used', async () => {
        const { key, secret } = await createKey('tracked', 'send');
        await sendWith(secret);
        await new Promise(r => setTimeout(r, 50)); // the update is written in the background
        const list = await admin(request(app).get('/api/keys'));
        assert.ok(list.body.keys.find(k => k.id === key.id).lastUsedAt);
    });

    test('a revoked key stops working and can no longer be revealed', async () => {
        const { key, secret } = await createKey('to-revoke', 'send');
        assert.equal((await sendWith(secret)).status, 201);
        const revoked = await admin(request(app).delete(`/api/keys/${key.id}`));
        assert.equal(revoked.status, 200);
        assert.ok(revoked.body.key.revokedAt);
        const after = await sendWith(secret);
        assert.equal(after.status, 401);
        assert.match(after.body.error, /revoked/);
        assert.equal((await admin(request(app).post(`/api/keys/${key.id}/reveal`))).status, 410);
    });

    test('imported .env keys work and record when they were used', async () => {
        assert.equal((await sendWith(ENV_KEY)).status, 201);
        await new Promise(r => setTimeout(r, 50));
        const list = await admin(request(app).get('/api/keys'));
        assert.ok(list.body.keys.find(k => k.name === 'legacy').lastUsedAt);
    });

    test('unknown keys are rejected', async () => {
        assert.equal((await sendWith('sms_send_' + 'A'.repeat(43))).status, 401);
        assert.equal((await sendWith('not-a-key')).status, 401);
    });
});

describe('importing INGEST_API_KEYS', () => {
    test('is idempotent across restarts', async () => {
        const { imported } = await buildApp();
        assert.deepEqual(imported, []);
        const list = await admin(request(app).get('/api/keys'));
        assert.equal(list.body.keys.filter(k => k.source === 'env').length, 1);
    });

    test('a key revoked in the dashboard stays revoked, even while it is still in .env', async () => {
        const value = 'revoke-me-env-key-0123456789';
        const { app: started } = await buildApp({ INGEST_API_KEYS: `legacy:${ENV_KEY},old-app:${value}` });
        const key = (await request(started).get('/api/keys').set('Authorization', `Bearer ${ADMIN_TOKEN}`)).body.keys.find(k => k.name === 'old-app');
        await request(started).delete(`/api/keys/${key.id}`).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
        const { app: restarted, imported } = await buildApp({ INGEST_API_KEYS: `legacy:${ENV_KEY},old-app:${value}` });
        assert.deepEqual(imported, []);
        const res = await request(restarted).post('/api/messages').set('X-API-Key', value).send({ phone: '15556660000', message: 'x' });
        assert.equal(res.status, 401);
    });

    test('a name already used by a different key gets a suffix', async () => {
        await createKey('mobile', 'send');
        const { imported } = await buildApp({ INGEST_API_KEYS: 'mobile:another-env-key-0123456789' });
        assert.deepEqual(imported, [{ name: 'mobile', storedAs: 'mobile-2' }]);
    });

    test('removing a key from .env does not revoke it (it is managed in the dashboard now)', async () => {
        const { app: withoutEnv } = await buildApp({ INGEST_API_KEYS: '' });
        const res = await request(withoutEnv).post('/api/messages').set('X-API-Key', ENV_KEY).send({ phone: '15557770000', message: 'x' });
        assert.equal(res.status, 201);
    });
});

describe('SESSION_SECRET changes', () => {
    test('keys keep working but can no longer be revealed', async () => {
        const { key, secret } = await createKey('survivor', 'send');
        const { app: otherApp } = await buildApp({ SESSION_SECRET: 't'.repeat(48) });
        assert.equal((await request(otherApp).post('/api/messages').set('X-API-Key', secret).send({ phone: '15554440000', message: 'hi' })).status, 201);
        const reveal = await request(otherApp).post(`/api/keys/${key.id}/reveal`).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
        assert.equal(reveal.status, 409);
        assert.match(reveal.body.error, /SESSION_SECRET/);
    });
});
