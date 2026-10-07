const { createSessionToken, verifySessionToken, safeEqual, parseCookies } = require('../utils/session');
const { logToFile } = require('../utils/logger');

const SESSION_COOKIE = 'sms_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Who can do what:
//   admin (dashboard session, ADMIN_TOKEN, or AUTH_DISABLED)  everything
//   Send key (INGEST_API_KEYS, or created in the dashboard)    POST /api/messages
//   Read key (created in the dashboard)                         GET /api/messages and /api/messages/latest
function createAuth(config, { apiKeyModel } = {}) {
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;

    const bearerToken = req => {
        const header = req.get('authorization') || '';
        return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    };

    // Returns how the request is authenticated as admin: 'disabled', 'bearer', 'cookie' or null
    function adminAuthMethod(req) {
        if (config.authDisabled) return 'disabled';
        const bearer = bearerToken(req);
        if (config.adminToken && bearer && safeEqual(bearer, config.adminToken)) return 'bearer';
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

    // Finds the API key a request presents (X-API-Key, or Authorization: Bearer for dashboard keys).
    // Returns { name, scope, source } or null.
    async function findApiKey(req) {
        const presented = req.get('x-api-key') || bearerToken(req);
        if (!presented) return null;
        // .env keys: compare against every key so the response time doesn't reveal which one matched
        let envMatch = null;
        for (const entry of config.ingestApiKeys) {
            if (safeEqual(presented, entry.key) && !envMatch) envMatch = entry;
        }
        if (envMatch) return { name: envMatch.name, scope: 'send', source: 'env' };
        const stored = apiKeyModel ? await apiKeyModel.authenticate(presented) : null;
        return stored ? { name: stored.name, scope: stored.scope, source: 'dashboard' } : null;
    }

    function requireAdmin(req, res, next) {
        const method = adminAuthMethod(req);
        if (!method) return res.status(401).json({ error: 'Authentication required' });
        if (!passesCsrfCheck(req, method)) return res.status(403).json({ error: 'Missing X-Requested-With header' });
        req.auth = { method, isAdmin: true };
        next();
    }

    // Admin, or an API key with the given scope
    function requireKeyOrAdmin(scope) {
        return async (req, res, next) => {
            const method = adminAuthMethod(req);
            if (method) {
                if (!passesCsrfCheck(req, method)) return res.status(403).json({ error: 'Missing X-Requested-With header' });
                req.auth = { method, apiKeyName: 'dashboard', isAdmin: true };
                return next();
            }
            const key = await findApiKey(req);
            if (!key) {
                const presented = req.get('x-api-key') || bearerToken(req);
                return res.status(401).json({ error: presented ? 'Invalid or revoked API key' : 'Missing API key' });
            }
            if (key.scope !== scope) {
                return res.status(403).json({
                    error: scope === 'send' ? 'This is a Read key; sending messages needs a Send key'
                        : 'This is a Send key; reading messages needs a Read key',
                });
            }
            req.auth = { method: 'apiKey', apiKeyName: key.name, scope: key.scope, isAdmin: false };
            next();
        };
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

    return {
        adminAuthMethod,
        requireAdmin,
        requireIngest: requireKeyOrAdmin('send'),
        requireRead: requireKeyOrAdmin('read'),
        login,
        logout,
        status,
    };
}

module.exports = { createAuth, SESSION_COOKIE };
