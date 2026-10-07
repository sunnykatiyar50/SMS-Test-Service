const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-viewers-logs-'));

const request = require('supertest');
const { loadConfig } = require('../src/config');
const initializeDatabase = require('../src/database/initDatabase');
const MessageModel = require('../src/models/messageModel');
const ApiKeyModel = require('../src/models/apiKeyModel');
const { createApp } = require('../src/server');

const env = {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-password-1',
    VIEWER_USERS: 'alice:alice-password-1,bob:bob:pass:word',
    SESSION_SECRET: 'v'.repeat(48),
};

let db;
let app;

function build(overrides = {}) {
    const config = loadConfig({ ...env, ...overrides });
    return createApp({ config, messageModel: new MessageModel(db), apiKeyModel: new ApiKeyModel(db, { encryptionSecret: config.sessionSecret }) });
}

async function login(target, username, password) {
    const res = await request(target).post('/auth/login').send({ username, password });
    return { res, cookie: res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : null };
}

before(async () => {
    db = await initializeDatabase();
    app = build();
    // A message to look at
    const { cookie } = await login(app, 'admin', env.ADMIN_PASSWORD);
    await request(app).post('/api/messages').set('Cookie', cookie).set('X-Requested-With', 'fetch')
        .send({ phone: '15551234567', message: 'Your code is 112233' });
});

after(async () => {
    await db.close();
});

describe('config', () => {
    test('parses VIEWER_USERS (passwords may contain colons)', () => {
        assert.deepEqual(loadConfig(env).viewerUsers, [
            { username: 'alice', password: 'alice-password-1' },
            { username: 'bob', password: 'bob:pass:word' },
        ]);
    });

    test('rejects bad entries', () => {
        for (const value of ['al ice:long-enough-1', 'alice:short', 'admin:long-enough-1', 'alice:long-enough-1,ALICE:long-enough-2', 'alice:change-me-1234']) {
            assert.throws(() => loadConfig({ ...env, VIEWER_USERS: value }), /Invalid auth configuration/, value);
        }
    });
});

describe('viewer sign-in', () => {
    test('a viewer can sign in and is reported as a viewer', async () => {
        const { res, cookie } = await login(app, 'alice', 'alice-password-1');
        assert.equal(res.status, 200);
        assert.equal(res.body.role, 'viewer');
        const status = await request(app).get('/auth/status').set('Cookie', cookie);
        assert.deepEqual(status.body, { authenticated: true, authDisabled: false, username: 'alice', role: 'viewer' });
        assert.equal((await request(app).get('/').set('Cookie', cookie)).status, 200);
    });

    test('wrong passwords and unknown users are rejected the same way', async () => {
        for (const [u, p] of [['alice', 'wrong-password'], ['nobody', 'alice-password-1'], ['alice', 'admin-password-1']]) {
            const { res } = await login(app, u, p);
            assert.equal(res.status, 401);
            assert.equal(res.body.error, 'Incorrect username or password');
        }
    });
});

describe('what a viewer can do', () => {
    let cookie;
    before(async () => {
        ({ cookie } = await login(app, 'alice', 'alice-password-1'));
    });
    const asViewer = r => r.set('Cookie', cookie).set('X-Requested-With', 'fetch');

    test('can list messages and fetch the latest one', async () => {
        const list = await asViewer(request(app).get('/api/messages'));
        assert.equal(list.status, 200);
        assert.equal(list.body.totalMessages >= 1, true);
        const latest = await asViewer(request(app).get('/api/messages/latest?phone=15551234567'));
        assert.equal(latest.body.code, '112233');
    });

    test('cannot send messages', async () => {
        const res = await asViewer(request(app).post('/api/messages')).send({ phone: '15551234567', message: 'nope' });
        assert.equal(res.status, 403);
        assert.match(res.body.error, /only view/);
    });

    test('cannot delete messages', async () => {
        assert.equal((await asViewer(request(app).delete('/api/messages/1'))).status, 403);
        assert.equal((await asViewer(request(app).delete('/api/messages')).send({ ids: [1] })).status, 403);
    });

    test('cannot list, create, reveal or revoke API keys', async () => {
        assert.equal((await asViewer(request(app).get('/api/keys'))).status, 403);
        assert.equal((await asViewer(request(app).post('/api/keys')).send({ name: 'x', scope: 'send' })).status, 403);
        assert.equal((await asViewer(request(app).post('/api/keys/1/reveal'))).status, 403);
        assert.equal((await asViewer(request(app).delete('/api/keys/1'))).status, 403);
    });
});

describe('sessions follow .env', () => {
    test('changing a viewer password signs that viewer out', async () => {
        const { cookie } = await login(app, 'alice', 'alice-password-1');
        const changed = build({ VIEWER_USERS: 'alice:a-new-password-2,bob:bob:pass:word' });
        assert.equal((await request(changed).get('/api/messages').set('Cookie', cookie)).status, 401);
        assert.equal((await request(app).get('/api/messages').set('Cookie', cookie)).status, 200);
    });

    test('removing a viewer from .env ends their session', async () => {
        const { cookie } = await login(app, 'bob', 'bob:pass:word');
        const removed = build({ VIEWER_USERS: 'alice:alice-password-1' });
        assert.equal((await request(removed).get('/api/messages').set('Cookie', cookie)).status, 401);
    });

    test('changing ADMIN_PASSWORD signs the admin out', async () => {
        const { cookie } = await login(app, 'admin', env.ADMIN_PASSWORD);
        const changed = build({ ADMIN_PASSWORD: 'another-admin-pass' });
        assert.equal((await request(changed).get('/api/keys').set('Cookie', cookie)).status, 401);
        assert.equal((await request(app).get('/api/keys').set('Cookie', cookie)).status, 200);
    });

    test('a viewer session cannot be turned into an admin one', async () => {
        const { createSessionToken } = require('../src/utils/session');
        const { cookie } = await login(app, 'alice', 'alice-password-1');
        const payload = JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url').toString());
        // Re-signing needs SESSION_SECRET; without it, changing the role breaks the signature
        const tampered = Buffer.from(JSON.stringify({ ...payload, r: 'admin' })).toString('base64url') + '.' + cookie.split('.')[1];
        assert.equal((await request(app).get('/api/keys').set('Cookie', `sms_session=${tampered}`)).status, 401);
        // Even with the secret, alice's password fingerprint doesn't match the admin account
        const forged = createSessionToken(env.SESSION_SECRET, 60000, { ...payload, u: 'admin', r: 'admin' });
        assert.equal((await request(app).get('/api/keys').set('Cookie', `sms_session=${forged}`)).status, 401);
    });
});
