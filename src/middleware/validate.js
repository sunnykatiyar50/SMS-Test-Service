// Request validation. Each validator either stores the cleaned values on req or responds with 400.

const MAX_SENDER = 64;
const MAX_MESSAGE = 1600; // 10 concatenated SMS segments
const MAX_PAGE_SIZE = 100;
const MAX_BULK_DELETE = 500;
const PHONE_RE = /^\+?[0-9]{6,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Strips the formatting characters people commonly put in phone numbers: spaces, dashes, dots, brackets
function normalizePhone(value) {
    return typeof value === 'string' ? value.replace(/[\s\-.()]/g, '') : value;
}

function badRequest(res, errors) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
}

function validateNewMessage(req, res, next) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const errors = {};

    const sender = body.sender === undefined || body.sender === null ? '' : body.sender;
    if (typeof sender !== 'string' || sender.length > MAX_SENDER) {
        errors.sender = `must be a string of at most ${MAX_SENDER} characters`;
    }

    const phone = normalizePhone(body.phone);
    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) {
        errors.phone = 'must be a phone number with 6-15 digits and an optional leading +';
    }

    const message = body.message;
    if (typeof message !== 'string' || message.trim() === '') {
        errors.message = 'is required';
    } else if (message.length > MAX_MESSAGE) {
        errors.message = `must be at most ${MAX_MESSAGE} characters`;
    }

    if (Object.keys(errors).length) return badRequest(res, errors);
    req.validated = { sender: sender.trim(), phone, message };
    next();
}

// Parses a date-only value as the start of that day in UTC
function parseDay(value) {
    if (!DATE_RE.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Accepts either from/to (ISO date-times, e.g. local midnight from the browser)
// or startDate/endDate (YYYY-MM-DD in UTC, endDate inclusive)
function validateListQuery(req, res, next) {
    const q = req.query;
    const errors = {};
    const str = name => (typeof q[name] === 'string' ? q[name].trim() : '');

    const page = str('page') ? parseInt(str('page'), 10) : 1;
    if (!Number.isInteger(page) || page < 1) errors.page = 'must be a positive integer';

    const pageSize = str('pageSize') ? parseInt(str('pageSize'), 10) : 10;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        errors.pageSize = `must be between 1 and ${MAX_PAGE_SIZE}`;
    }

    let from = null;
    let to = null;
    if (str('from')) {
        from = parseDateTime(str('from'));
        if (!from) errors.from = 'must be an ISO date-time';
    } else if (str('startDate')) {
        from = parseDay(str('startDate'));
        if (!from) errors.startDate = 'must be YYYY-MM-DD';
    }
    if (str('to')) {
        to = parseDateTime(str('to'));
        if (!to) errors.to = 'must be an ISO date-time';
    } else if (str('endDate')) {
        to = parseDay(str('endDate'));
        if (!to) errors.endDate = 'must be YYYY-MM-DD';
        else to = new Date(to.getTime() + 24 * 60 * 60 * 1000); // inclusive end day
    }

    const search = str('search').slice(0, 200);
    const phone = str('phone') ? normalizePhone(str('phone')) : '';

    if (Object.keys(errors).length) return badRequest(res, errors);
    req.listQuery = {
        page,
        pageSize,
        filters: { search, phone, from, to },
        unmask: str('unmask') === 'true',
    };
    next();
}

function parseId(value) {
    const s = String(value);
    if (!/^[1-9][0-9]{0,15}$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
}

function validateIdParam(req, res, next) {
    const id = parseId(req.params.id);
    if (id === null) return badRequest(res, { id: 'must be a positive integer' });
    req.validated = { ids: [id] };
    next();
}

function validateIdList(req, res, next) {
    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK_DELETE) {
        return badRequest(res, { ids: `must be an array of 1-${MAX_BULK_DELETE} ids` });
    }
    const parsed = ids.map(parseId);
    if (parsed.includes(null)) return badRequest(res, { ids: 'must contain only positive integers' });
    req.validated = { ids: [...new Set(parsed)] };
    next();
}

module.exports = {
    validateNewMessage,
    validateListQuery,
    validateIdParam,
    validateIdList,
    normalizePhone,
    MAX_MESSAGE,
};
