const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-test-logs-'));

const request = require('supertest');
const { loadConfig } = require('../src/config');
const initializeDatabase = require('../src/database/initDatabase');
const MessageModel = require('../src/models/messageModel');
const { createApp } = require('../src/server');

const INGEST_KEY = 'ci-ingest-key-0123456789';
const ADMIN_TOKEN = 'admin-token-0123456789';
const ADMIN_PASSWORD = 'correct horse battery staple';

const env = {
    INGEST_API_KEYS: `ci:${INGEST_KEY}`,
    ADMIN_TOKEN,
    ADMIN_USERNAME: 'opsadmin',
    ADMIN_PASSWORD,
    SESSION_SECRET: 'x'.repeat(48),
};

let app;
let db;
const admin = r => r.set('Authorization', `Bearer ${ADMIN_TOKEN}`);
const ingest = body => request(app).post('/api/messages').set('X-API-Key', INGEST_KEY).send(body);

before(async () => {
    db = await initializeDatabase();
    app = createApp({ config: loadConfig(env), messageModel: new MessageModel(db) });
});

after(async () => {
    await db.close();
});

describe('config', () => {
    test('refuses to start without auth settings', () => {
        assert.throws(() => loadConfig({}), /Invalid auth configuration/);
    });

    test('AUTH_DISABLED skips the auth requirements', () => {
        assert.equal(loadConfig({ AUTH_DISABLED: 'true' }).authDisabled, true);
    });

    test('rejects the sample.env placeholder values', () => {
        assert.throws(() => loadConfig({ ...env, ADMIN_PASSWORD: 'change-me' }), /placeholder/);
    });

    test('rejects short API keys', () => {
        assert.throws(() => loadConfig({ ...env, INGEST_API_KEYS: 'ci:short' }), /16 characters/);
    });
});

describe('ingest', () => {
    test('rejects requests without an API key', async () => {
        const res = await request(app).post('/api/messages').send({ phone: '15551234567', message: 'hi' });
        assert.equal(res.status, 401);
    });

    test('rejects a wrong API key', async () => {
        const res = await request(app)
            .post('/api/messages')
            .set('X-API-Key', 'wrong-key-0123456789')
            .send({ phone: '15551234567', message: 'hi' });
        assert.equal(res.status, 401);
    });

    test('validates the payload', async () => {
        const res = await ingest({ phone: 'abc', message: '' });
        assert.equal(res.status, 400);
        assert.ok(res.body.details.phone);
        assert.ok(res.body.details.message);
    });

    test('rejects messages over 1600 characters', async () => {
        const res = await ingest({ phone: '15551234567', message: 'a'.repeat(1601) });
        assert.equal(res.status, 400);
    });

    test('rejects malformed JSON with 400', async () => {
        const res = await request(app)
            .post('/api/messages')
            .set('X-API-Key', INGEST_KEY)
            .set('Content-Type', 'application/json')
            .send('{"phone":');
        assert.equal(res.status, 400);
    });

    test('stores a valid message and records the key name', async () => {
        const res = await ingest({ sender: 'MyApp', phone: '+1 (555) 123-4567', message: 'Your OTP is 123456' });
        assert.equal(res.status, 201);
        assert.ok(res.body.id > 0);

        const list = await admin(request(app).get('/api/messages?unmask=true'));
        const stored = list.body.messages.find(m => m.id === res.body.id);
        assert.equal(stored.phone, '+15551234567');
        assert.equal(stored.apiKeyName, 'ci');
    });
});

describe('admin API', () => {
    test('requires authentication to read', async () => {
        assert.equal((await request(app).get('/api/messages')).status, 401);
        assert.equal((await request(app).get('/api/messages/latest')).status, 401);
    });

    test('requires authentication to delete', async () => {
        assert.equal((await request(app).delete('/api/messages/1')).status, 401);
    });

    test('masks phone numbers by default', async () => {
        await ingest({ phone: '919876543210', message: 'mask me' });
        const res = await admin(request(app).get('/api/messages?search=mask%20me'));
        assert.equal(res.status, 200);
        assert.equal(res.body.messages[0].phone, '********3210');
    });

    test('returns XSS payloads as inert data', async () => {
        const payload = '<img src=x onerror=alert(1)>';
        await ingest({ sender: '<script>x</script>', phone: '15550000001', message: payload });
        const res = await admin(request(app).get('/api/messages/latest?phone=15550000001'));
        assert.equal(res.status, 200);
        assert.equal(res.body.message, payload);
        assert.equal(res.headers['content-type'].startsWith('application/json'), true);
    });

    test('latest returns the newest message for a phone number', async () => {
        await ingest({ phone: '15550000002', message: 'Your code is 111111' });
        await ingest({ phone: '15550000002', message: 'Your code is 222222' });
        const res = await admin(request(app).get('/api/messages/latest?phone=15550000002'));
        assert.equal(res.body.message, 'Your code is 222222');
        assert.equal(res.body.code, '222222');
    });

    test('latest returns 404 when nothing matches', async () => {
        const res = await admin(request(app).get('/api/messages/latest?phone=15559999999'));
        assert.equal(res.status, 404);
    });

    test('paginates in the database', async () => {
        for (let i = 0; i < 12; i++) await ingest({ phone: '15550000003', message: `page test ${i}` });
        const page1 = await admin(request(app).get('/api/messages?phone=15550000003&pageSize=5'));
        assert.equal(page1.body.messages.length, 5);
        assert.equal(page1.body.totalMessages, 12);
        assert.equal(page1.body.totalPages, 3);
        assert.equal(page1.body.messages[0].message, 'page test 11');

        const page3 = await admin(request(app).get('/api/messages?phone=15550000003&pageSize=5&page=3'));
        assert.equal(page3.body.messages.length, 2);
        assert.equal(page3.body.currentPage, 3);
    });

    test('searches sender and phone as well as text', async () => {
        await ingest({ sender: 'UniqueSenderName', phone: '15550000004', message: 'abc' });
        const bySender = await admin(request(app).get('/api/messages?search=uniquesender'));
        assert.equal(bySender.body.totalMessages, 1);
        const byPhone = await admin(request(app).get('/api/messages?search=15550000004'));
        assert.equal(byPhone.body.totalMessages, 1);
    });

    test('filters by date range', async () => {
        const today = new Date().toISOString().slice(0, 10);
        const inRange = await admin(request(app).get(`/api/messages?startDate=${today}&endDate=${today}`));
        assert.ok(inRange.body.totalMessages > 0);
        const past = await admin(request(app).get('/api/messages?startDate=2000-01-01&endDate=2000-01-02'));
        assert.equal(past.body.totalMessages, 0);
    });

    test('validates query parameters', async () => {
        assert.equal((await admin(request(app).get('/api/messages?pageSize=1000'))).status, 400);
        assert.equal((await admin(request(app).get('/api/messages?startDate=yesterday'))).status, 400);
    });

    test('deletes a single message and returns 404 afterwards', async () => {
        const { body } = await ingest({ phone: '15550000005', message: 'delete me' });
        assert.equal((await admin(request(app).delete(`/api/messages/${body.id}`))).status, 200);
        assert.equal((await admin(request(app).delete(`/api/messages/${body.id}`))).status, 404);
    });

    test('rejects invalid ids', async () => {
        assert.equal((await admin(request(app).delete('/api/messages/abc'))).status, 400);
    });

    test('bulk deletes messages', async () => {
        const a = await ingest({ phone: '15550000006', message: 'bulk 1' });
        const b = await ingest({ phone: '15550000006', message: 'bulk 2' });
        const res = await admin(request(app).delete('/api/messages')).send({ ids: [a.body.id, b.body.id] });
        assert.equal(res.status, 200);
        assert.equal(res.body.deleted, 2);
    });
});

describe('dashboard session', () => {
    async function login() {
        const res = await request(app).post('/auth/login').send({ username: 'opsadmin', password: ADMIN_PASSWORD });
        assert.equal(res.status, 200);
        const cookie = res.headers['set-cookie'][0];
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=Strict/);
        return cookie.split(';')[0];
    }

    test('rejects a wrong password', async () => {
        const res = await request(app).post('/auth/login').send({ username: 'opsadmin', password: 'nope' });
        assert.equal(res.status, 401);
    });

    test('rejects a wrong username, even with the right password', async () => {
        const res = await request(app).post('/auth/login').send({ username: 'admin', password: ADMIN_PASSWORD });
        assert.equal(res.status, 401);
    });

    test('requires both username and password', async () => {
        const res = await request(app).post('/auth/login').send({ password: ADMIN_PASSWORD });
        assert.equal(res.status, 400);
    });

    test('reports the signed-in username', async () => {
        const cookie = await login();
        const res = await request(app).get('/auth/status').set('Cookie', cookie);
        assert.deepEqual(res.body, { authenticated: true, authDisabled: false, username: 'opsadmin' });
    });

    test('redirects the login page to the dashboard when already signed in', async () => {
        const cookie = await login();
        const res = await request(app).get('/login.html').set('Cookie', cookie);
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, '/');
    });

    test('a session for a different username is rejected', async () => {
        const { createSessionToken } = require('../src/utils/session');
        const forged = createSessionToken(env.SESSION_SECRET, 60000, { u: 'someone-else' });
        const res = await request(app).get('/api/messages').set('Cookie', `sms_session=${forged}`);
        assert.equal(res.status, 401);
    });

    test('redirects the dashboard to the login page without a session', async () => {
        const res = await request(app).get('/');
        assert.equal(res.status, 302);
        assert.equal(res.headers.location, '/login.html');
    });

    test('serves the dashboard with a session', async () => {
        const cookie = await login();
        const res = await request(app).get('/').set('Cookie', cookie);
        assert.equal(res.status, 200);
        assert.match(res.text, /SMS Test Service/);
    });

    test('a session can read and send through the test form', async () => {
        const cookie = await login();
        assert.equal((await request(app).get('/api/messages').set('Cookie', cookie)).status, 200);
        const sent = await request(app)
            .post('/api/messages')
            .set('Cookie', cookie)
            .set('X-Requested-With', 'fetch')
            .send({ sender: 'Form', phone: '15550000007', message: 'from dashboard' });
        assert.equal(sent.status, 201);
    });

    test('cookie-authenticated writes without X-Requested-With are refused (CSRF)', async () => {
        const cookie = await login();
        const res = await request(app).delete('/api/messages/1').set('Cookie', cookie);
        assert.equal(res.status, 403);
    });

    test('a tampered session cookie is rejected', async () => {
        const cookie = await login();
        const tampered = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
        assert.equal((await request(app).get('/api/messages').set('Cookie', tampered)).status, 401);
    });
});

describe('server', () => {
    test('health check is public', async () => {
        const res = await request(app).get('/health');
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
    });

    test('sends security headers', async () => {
        const res = await request(app).get('/login.html');
        assert.equal(res.status, 200);
        assert.match(res.headers['content-security-policy'], /script-src 'self'/);
        assert.equal(res.headers['x-powered-by'], undefined);
    });

    test('unknown API routes return JSON 404', async () => {
        const res = await request(app).get('/api/nope');
        assert.equal(res.status, 404);
        assert.equal(res.body.error, 'Not found');
    });

    test('message bodies are not written to the log', async () => {
        await ingest({ phone: '15550000008', message: 'secret-otp-987654' });
        const log = fs.readFileSync(path.join(process.env.LOG_DIR, 'app.log'), 'utf8');
        assert.equal(log.includes('secret-otp-987654'), false);
    });
});
