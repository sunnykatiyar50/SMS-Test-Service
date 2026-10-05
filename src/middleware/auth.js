const { createSessionToken, verifySessionToken, safeEqual, parseCookies } = require('../utils/session');
const { logToFile } = require('../utils/logger');

const SESSION_COOKIE = 'sms_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function createAuth(config) {
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;

    // Returns how the request is authenticated as admin: 'disabled', 'bearer', 'cookie' or null
    function adminAuthMethod(req) {
        if (config.authDisabled) return 'disabled';
        const header = req.get('authorization') || '';
        if (config.adminToken && header.startsWith('Bearer ') && safeEqual(header.slice(7), config.adminToken)) {
            return 'bearer';
        }
        const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
        const session = token && verifySessionToken(token, config.sessionSecret);
        // Changing ADMIN_USERNAME signs out existing sessions
        if (session && session.u === config.adminUsername) return 'cookie';
        return null;
    }

    // Cookie-authenticated writes must carry a custom header. Browsers cannot add it to a
    // cross-site request without a CORS preflight (which this server never approves), so this blocks CSRF.
    function passesCsrfCheck(req, method) {
        return method !== 'cookie' || SAFE_METHODS.has(req.method) || req.get('x-requested-with') === 'fetch';
    }

    function requireAdmin(req, res, next) {
        const method = adminAuthMethod(req);
        if (!method) return res.status(401).json({ error: 'Authentication required' });
        if (!passesCsrfCheck(req, method)) return res.status(403).json({ error: 'Missing X-Requested-With header' });
        req.auth = { method, isAdmin: true };
        next();
    }

    // Ingest accepts an X-API-Key from INGEST_API_KEYS, or an admin (used by the dashboard test form)
    function requireIngest(req, res, next) {
        const provided = req.get('x-api-key');
        if (provided) {
            // Compare against every key so the response time does not reveal which one matched
            let match = null;
            for (const entry of config.ingestApiKeys) {
                if (safeEqual(provided, entry.key) && !match) match = entry;
            }
            if (match) {
                req.auth = { method: 'apiKey', apiKeyName: match.name, isAdmin: false };
                return next();
            }
            if (!config.authDisabled) return res.status(401).json({ error: 'Invalid API key' });
        }
        const method = adminAuthMethod(req);
        if (!method) return res.status(401).json({ error: 'Missing X-API-Key header' });
        if (!passesCsrfCheck(req, method)) return res.status(403).json({ error: 'Missing X-Requested-With header' });
        req.auth = { method, apiKeyName: 'dashboard', isAdmin: true };
        next();
    }

    function cookieOptions(req) {
        return {
            httpOnly: true,
            sameSite: 'strict',
            secure: req.secure,
            path: '/',
        };
    }

    function login(req, res) {
        if (config.authDisabled) return res.json({ success: true });
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Enter your username and password' });
        }
        // Check both so the response time doesn't reveal which one was wrong
        const userOk = safeEqual(username.trim(), config.adminUsername);
        const passOk = safeEqual(password, config.adminPassword);
        if (!userOk || !passOk) {
            logToFile(`Failed dashboard login from ${req.ip}`);
            return res.status(401).json({ error: 'Incorrect username or password' });
        }
        res.cookie(SESSION_COOKIE, createSessionToken(config.sessionSecret, ttlMs, { u: config.adminUsername }), {
            ...cookieOptions(req),
            maxAge: ttlMs,
        });
        logToFile(`Dashboard login from ${req.ip}`);
        res.json({ success: true });
    }

    function logout(req, res) {
        res.clearCookie(SESSION_COOKIE, cookieOptions(req));
        res.json({ success: true });
    }

    function status(req, res) {
        const method = adminAuthMethod(req);
        res.json({
            authenticated: Boolean(method),
            authDisabled: config.authDisabled,
            username: method === 'cookie' ? config.adminUsername : null,
        });
    }

    return { adminAuthMethod, requireAdmin, requireIngest, login, logout, status };
}

module.exports = { createAuth, SESSION_COOKIE };
