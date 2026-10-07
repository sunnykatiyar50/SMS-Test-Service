// SMS Test Service dashboard. Message data is always rendered with textContent, never as HTML.

let messages = [];
let currentPage = 1;
let pageSize = 10;
let totalPages = 1;
let selectedId = null;

const $ = id => document.getElementById(id);

// --- Utilities ---

// fetch wrapper: marks requests as same-origin script calls (required by the server for
// cookie-authenticated writes) and sends the user to the login page when the session expires
async function apiFetch(url, options = {}) {
    const headers = { 'X-Requested-With': 'fetch', ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
        window.location.href = '/login.html';
        throw new Error('Not authenticated');
    }
    return response;
}

function readSetting(key, fallback) {
    try {
        return localStorage.getItem(key) || fallback;
    } catch {
        return fallback;
    }
}

function saveSetting(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // storage unavailable: the setting just isn't remembered
    }
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// Visible text of an HTML message for the list preview. DOMParser documents are inert:
// scripts don't run and images aren't fetched.
function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, head').forEach(node => node.remove());
    return doc.body ? doc.body.textContent : '';
}

function truncateMessage(message, maxLength = 120) {
    if (!message) return '';
    const singleLine = message.replace(/[\r\n]+/g, ' ').trim();
    return singleLine.length <= maxLength ? singleLine : singleLine.slice(0, maxLength - 1) + '…';
}

function formatMessageTime(timestamp) {
    const msgDate = new Date(timestamp);
    const diffMin = Math.floor((Date.now() - msgDate) / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 1) return 'Just now';
    if (diffHr < 1) return `${diffMin} min ago`;
    if (diffDay < 1) return `${diffHr} h ago`;
    if (diffDay < 7) return `${diffDay} d ago`;
    return msgDate.toLocaleDateString();
}

// Converts a YYYY-MM-DD value from a date input to an ISO timestamp for local midnight
// (optionally the following midnight, so the end date is inclusive)
function localDayToIso(value, nextDay = false) {
    if (!value) return '';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d + (nextDay ? 1 : 0)).toISOString();
}

// --- Quick time ranges (sidebar) ---

const MINUTE = 60 * 1000;
const RANGES = {
    '10m': { ms: 10 * MINUTE, label: 'Last 10 minutes' },
    '1h': { ms: 60 * MINUTE, label: 'Last 1 hour' },
    '8h': { ms: 8 * 60 * MINUTE, label: 'Last 8 hours' },
    '24h': { ms: 24 * 60 * MINUTE, label: 'Last 1 day' },
    '7d': { ms: 7 * 24 * 60 * MINUTE, label: 'Last 1 week' },
    '30d': { ms: 30 * 24 * 60 * MINUTE, label: 'Last 1 month' },
};
let timeRange = 'all'; // a RANGES key, 'all', or 'custom' (dates picked in the toolbar)

// Keeps the sidebar dropdown and the header chip in sync with the current range
function renderRange() {
    $('rangeSelect').value = timeRange;
    const range = RANGES[timeRange];
    $('rangeChip').classList.toggle('hidden', !range);
    $('rangeChipText').textContent = range ? range.label : '';
    $('rangeIconButton').classList.toggle('active', timeRange !== 'all');
}

async function setTimeRange(value) {
    timeRange = RANGES[value] ? value : 'all';
    // A quick range replaces any picked dates
    $('startDate').value = '';
    $('endDate').value = '';
    renderRange();
    if (currentView() !== 'messages') location.hash = '#/messages';
    else await filterMessages();
}

async function copyText(text, button) {
    const original = button.textContent;
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
    } catch {
        button.textContent = 'Copy failed';
    }
    setTimeout(() => (button.textContent = original), 1500);
}

// --- Navigation ---

const VIEWS = ['messages', 'send', 'keys', 'api'];
const VIEW_TITLES = { messages: 'Messages', send: 'Send test', keys: 'API keys', api: 'API reference' };

function currentView() {
    const name = location.hash.replace(/^#\/?/, '');
    if (userRole === 'viewer' && ADMIN_VIEWS.includes(name)) {
        history.replaceState(null, '', '#/messages'); // keep the address bar honest
        return 'messages';
    }
    return VIEWS.includes(name) ? name : 'messages';
}

function showView() {
    const view = currentView();
    document.querySelectorAll('.view').forEach(section => section.classList.toggle('hidden', section.dataset.view !== view));
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
        const active = link.dataset.view === view;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    document.title = `${VIEW_TITLES[view]} · SMS Test Service`;
    if (view === 'messages') reloadWithSavedParams();
    if (view === 'send') $('phoneInput').value ? $('messageInput').focus() : $('senderInput').focus();
    if (view === 'keys') loadKeys();
    else forgetRevealedKeys();
}

function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    const button = $('collapseButton');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    button.setAttribute('aria-label', button.title);
    saveSetting('sms_sidebar_collapsed', collapsed ? 'yes' : 'no');
}

// --- Resizable sidebar ---

const SIDEBAR_DEFAULT = 232;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_COLLAPSE_AT = 120; // dragging narrower than this collapses to icons

function applySidebarWidth(px) {
    document.documentElement.style.setProperty('--sidebar-width', `${px}px`);
    $('sidebarResizer').setAttribute('aria-valuenow', String(px));
    // The message pane's width is a share of the remaining space, so let it re-measure
    window.dispatchEvent(new Event('resize'));
}

// Applied as soon as the script runs, before the first paint, so the sidebar doesn't jump
(function restoreSidebarWidth() {
    const saved = parseInt(readSetting('sms_sidebar_width', ''), 10);
    if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
        document.documentElement.style.setProperty('--sidebar-width', `${saved}px`);
    }
})();

function initSidebarResizer() {
    const handle = $('sidebarResizer');
    // The target width (CSS variable), not the measured one, which lags while the width animates
    const current = () =>
        parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10) || SIDEBAR_DEFAULT;
    const clamp = px => Math.min(Math.max(Math.round(px), SIDEBAR_MIN), SIDEBAR_MAX);
    handle.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
    handle.setAttribute('aria-valuemax', String(SIDEBAR_MAX));
    handle.setAttribute('aria-valuenow', String(current()));

    handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add('resizing');
        const left = $('sidebar').getBoundingClientRect().left;
        let width = current();
        let wantsCollapse = false;
        let frame = 0;
        const onMove = moveEvent => {
            const raw = moveEvent.clientX - left;
            wantsCollapse = raw < SIDEBAR_COLLAPSE_AT;
            handle.classList.toggle('will-collapse', wantsCollapse);
            width = clamp(raw);
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => applySidebarWidth(width));
        };
        const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('resizing');
            handle.classList.remove('will-collapse');
            if (wantsCollapse) {
                // Keep the last expanded width for when the sidebar is expanded again
                applySidebarWidth(clamp(parseInt(readSetting('sms_sidebar_width', ''), 10) || SIDEBAR_DEFAULT));
                setSidebarCollapsed(true);
            } else {
                saveSetting('sms_sidebar_width', String(width));
            }
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    });
    // Keyboard: arrow keys resize in 16px steps
    handle.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const width = clamp(current() + (event.key === 'ArrowRight' ? 16 : -16));
        applySidebarWidth(width);
        saveSetting('sms_sidebar_width', String(width));
    });
    handle.addEventListener('dblclick', () => {
        applySidebarWidth(SIDEBAR_DEFAULT);
        saveSetting('sms_sidebar_width', String(SIDEBAR_DEFAULT));
    });
}

// The signed-in account's role: 'admin' or 'viewer'. Viewers only see messages; the server
// enforces this too, the dashboard just hides what they can't use.
let userRole = 'admin';
const ADMIN_VIEWS = ['send', 'keys'];

async function loadSession() {
    try {
        const response = await fetch('/auth/status');
        const status = await response.json();
        userRole = status.role === 'viewer' ? 'viewer' : 'admin';
        const name = status.username || (status.authDisabled ? 'No sign-in' : 'admin');
        $('currentUser').textContent = userRole === 'viewer' ? `${name} (viewer)` : name;
        $('authWarning').classList.toggle('hidden', !status.authDisabled);
        $('logoutButton').classList.toggle('hidden', Boolean(status.authDisabled));
    } catch {
        // keep defaults
    }
    document.body.classList.toggle('role-viewer', userRole === 'viewer');
}

async function logout() {
    try {
        await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
        window.location.href = '/login.html';
    }
}

// --- Messages: loading and rendering ---

function currentFilters() {
    return {
        searchInput: $('searchInput').value,
        startDate: $('startDate').value,
        endDate: $('endDate').value,
    };
}

async function loadMessages(page = 1, pageSizeParam = pageSize, searchInput = '', startDate = '', endDate = '') {
    saveSetting('sms_query_params', JSON.stringify({ page, pageSize: pageSizeParam, searchInput, startDate, endDate, timeRange }));
    try {
        const queryParams = new URLSearchParams({ page, pageSize: pageSizeParam });
        if (searchInput) queryParams.set('search', searchInput);
        if (startDate) queryParams.set('from', localDayToIso(startDate));
        if (endDate) queryParams.set('to', localDayToIso(endDate, true));
        // Relative ranges are recalculated on every load, so the window keeps sliding
        if (!startDate && !endDate && RANGES[timeRange]) {
            queryParams.set('from', new Date(Date.now() - RANGES[timeRange].ms).toISOString());
        }

        const response = await apiFetch(`/api/messages?${queryParams.toString()}`);
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        messages = data.messages || [];
        currentPage = data.currentPage || page;
        totalPages = data.totalPages || 1;
        const filtered = Boolean(searchInput || startDate || endDate || RANGES[timeRange]);
        $('messageInfo').textContent = `${data.totalMessages} ${filtered ? 'matching' : 'total'}`;
        if (!filtered) $('navCount').textContent = data.totalMessages || '';
    } catch (error) {
        messages = [];
        totalPages = 1;
        $('messageInfo').textContent = 'Could not load messages';
    }
    renderMessages();
    updatePagination();
}

async function reloadCurrentPage() {
    const { searchInput, startDate, endDate } = currentFilters();
    await loadMessages(currentPage, pageSize, searchInput, startDate, endDate);
}

function renderMessages() {
    const list = $('messageList');
    list.replaceChildren();
    $('selectAllCheckbox').checked = false;
    updateSelectionInfo();

    if (messages.length === 0) {
        const filtered = Object.values(currentFilters()).some(Boolean) || Boolean(RANGES[timeRange]);
        list.appendChild(el('li', 'empty-state', filtered ? 'No messages match these filters.' : 'No messages yet. Send one from Send test, or call the API.'));
        showDetails(null);
        return;
    }

    if (!messages.some(m => m.id === selectedId)) selectedId = messages[0].id;

    for (const msg of messages) {
        const li = el('li', 'message-row');
        li.dataset.id = String(msg.id);
        if (msg.id === selectedId) li.classList.add('selected');
        li.addEventListener('click', event => {
            if (event.target.closest('.row-check')) return;
            selectMessage(msg.id);
        });

        const check = el('input', 'message-checkbox');
        check.type = 'checkbox';
        check.dataset.id = String(msg.id);
        check.setAttribute('aria-label', `Select message ${msg.id}`);
        check.addEventListener('change', updateSelectionInfo);
        const checkWrap = el('label', 'row-check admin-only');
        checkWrap.appendChild(check);

        const top = el('div', 'row-top');
        top.appendChild(el('span', 'row-sender', msg.sender || 'No sender'));
        top.appendChild(el('span', 'row-phone mono', msg.phone || ''));
        top.appendChild(el('span', 'spacer'));
        const time = el('time', 'row-time', msg.timestamp ? formatMessageTime(msg.timestamp) : '');
        if (msg.timestamp) time.title = new Date(msg.timestamp).toLocaleString();
        top.appendChild(time);

        const body = el('div', 'row-body');
        body.appendChild(top);
        // Readable one-line preview (HTML as text, syslog as "app: message"); the format badge is only in the detail pane
        body.appendChild(el('div', 'row-text', truncateMessage(MessageFormat.previewText(msg.message || '', undefined, htmlToText))));

        li.appendChild(checkWrap);
        li.appendChild(body);
        list.appendChild(li);
    }
    showDetails(messages.find(m => m.id === selectedId));
}

function selectMessage(id) {
    selectedId = id;
    document.querySelectorAll('.message-row').forEach(row => row.classList.toggle('selected', row.dataset.id === String(id)));
    showDetails(messages.find(m => m.id === id));
}

function showDetails(message) {
    $('detailEmpty').classList.toggle('hidden', Boolean(message));
    $('detailBody').classList.toggle('hidden', !message);
    if (!message) return;

    $('selectedMessageTitle').textContent = message.sender || 'No sender';
    $('selectedMessageKey').textContent = message.apiKeyName ? `via ${message.apiKeyName}` : '';
    $('selectedMessageKey').classList.toggle('hidden', !message.apiKeyName);
    $('selectedMessageTimestamp').textContent = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
    $('selectedMessagePhone').textContent = message.phone || '';
    $('selectedMessageLength').textContent = `${(message.message || '').length} characters`;

    // The server detects the code (see src/utils/otp.js) and returns it as `code`
    const code = message.code;
    $('copyCodeButton').classList.toggle('hidden', !code);
    $('copyCodeButton').textContent = code ? `Copy code ${code}` : 'Copy code';
    $('copyCodeButton').dataset.code = code || '';

    renderMessageBody(message);
}

// Renders the message as JSON / HTML / XML / syslog / text (see formatters.js) with a view switcher.
// The chosen view is remembered per format.
function renderMessageBody(message, view) {
    const text = message.message || '';
    const format = MessageFormat.detectFormat(text);
    const chosen = view || readSetting(`sms_view_${format}`, '');
    const result = MessageFormat.renderMessage($('selectedMessageText'), text, { view: chosen });

    $('formatBadge').textContent = MessageFormat.LABELS[result.format];
    $('formatBadge').dataset.format = result.format;
    const switcher = $('viewSwitch');
    switcher.replaceChildren();
    for (const name of result.views) {
        const button = el('button', name === result.view ? 'active' : '', MessageFormat.LABELS[name]);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(name === result.view));
        button.addEventListener('click', () => {
            saveSetting(`sms_view_${result.format}`, name);
            renderMessageBody(message, name);
        });
        switcher.appendChild(button);
    }
}

// Up/down arrow keys move through the list
function moveSelection(step) {
    const idx = messages.findIndex(m => m.id === selectedId);
    const next = messages[idx + step];
    if (!next) return;
    selectMessage(next.id);
    const row = document.querySelector(`.message-row[data-id="${next.id}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
}

// --- Resizable message pane ---

const DEFAULT_DETAIL_RATIO = 0.42;
const MIN_DETAIL_PX = 300;
const MIN_LIST_PX = 360;

// The detail pane width is stored as a share of the layout, so it adapts when the window is resized
function applyDetailRatio(ratio) {
    const layout = document.querySelector('.messages-layout');
    const width = layout.getBoundingClientRect().width;
    if (!width) return;
    const px = Math.min(Math.max(ratio * width, MIN_DETAIL_PX), Math.max(MIN_DETAIL_PX, width - MIN_LIST_PX));
    layout.style.setProperty('--detail-width', `${Math.round(px)}px`);
    $('paneResizer').setAttribute('aria-valuenow', String(Math.round((px / width) * 100)));
}

function initPaneResizer() {
    const layout = document.querySelector('.messages-layout');
    const resizer = $('paneResizer');
    let ratio = parseFloat(readSetting('sms_detail_ratio', '')) || DEFAULT_DETAIL_RATIO;
    const apply = () => applyDetailRatio(ratio);
    const save = () => saveSetting('sms_detail_ratio', ratio.toFixed(3));
    resizer.setAttribute('aria-valuemin', '20');
    resizer.setAttribute('aria-valuemax', '75');

    resizer.addEventListener('pointerdown', event => {
        event.preventDefault();
        resizer.setPointerCapture(event.pointerId);
        document.body.classList.add('resizing');
        const onMove = moveEvent => {
            const rect = layout.getBoundingClientRect();
            ratio = Math.min(Math.max((rect.right - moveEvent.clientX) / rect.width, 0.2), 0.75);
            apply();
        };
        const onUp = () => {
            resizer.removeEventListener('pointermove', onMove);
            resizer.removeEventListener('pointerup', onUp);
            resizer.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('resizing');
            save();
        };
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', onUp);
        resizer.addEventListener('pointercancel', onUp);
    });
    // Keyboard: arrow keys resize in 2% steps
    resizer.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        ratio = Math.min(Math.max(ratio + (event.key === 'ArrowLeft' ? 0.02 : -0.02), 0.2), 0.75);
        apply();
        save();
    });
    resizer.addEventListener('dblclick', () => {
        ratio = DEFAULT_DETAIL_RATIO;
        apply();
        save();
    });
    window.addEventListener('resize', apply);
    window.addEventListener('hashchange', () => requestAnimationFrame(apply));
    apply();
}

// --- Messages: pagination, filters, selection ---

function updatePagination() {
    $('prevPage').disabled = currentPage <= 1;
    $('nextPage').disabled = currentPage >= totalPages;
    $('pageInfo').textContent = `${currentPage} / ${totalPages}`;
}

async function changePage(direction) {
    currentPage = Math.min(Math.max(1, currentPage + direction), totalPages);
    await reloadCurrentPage();
}

async function changePageSize() {
    pageSize = parseInt($('pageSizeSelect').value, 10);
    currentPage = 1;
    await reloadCurrentPage();
}

async function filterMessages() {
    currentPage = 1;
    await reloadCurrentPage();
}

async function resetFilters() {
    $('searchInput').value = '';
    $('startDate').value = '';
    $('endDate').value = '';
    timeRange = 'all';
    renderRange();
    await filterMessages();
}

// Picking dates in the toolbar switches the sidebar range to "Custom dates"
async function onDateChange() {
    const hasDates = Boolean($('startDate').value || $('endDate').value);
    timeRange = hasDates ? 'custom' : 'all';
    renderRange();
    await filterMessages();
}

function reloadWithSavedParams() {
    try {
        const saved = JSON.parse(readSetting('sms_query_params', 'null'));
        if (saved) {
            $('searchInput').value = saved.searchInput || '';
            $('startDate').value = saved.startDate || '';
            $('endDate').value = saved.endDate || '';
            timeRange = RANGES[saved.timeRange] || saved.timeRange === 'custom' ? saved.timeRange : 'all';
            renderRange();
            if (saved.pageSize) {
                pageSize = saved.pageSize;
                $('pageSizeSelect').value = saved.pageSize;
            }
            loadMessages(saved.page || 1, pageSize, saved.searchInput || '', saved.startDate || '', saved.endDate || '');
            return;
        }
    } catch {
        // fall through: load all
    }
    loadMessages(1, pageSize);
}

function selectedIds() {
    return Array.from(document.querySelectorAll('.message-checkbox:checked')).map(c => Number(c.dataset.id));
}

function updateSelectionInfo() {
    const count = selectedIds().length;
    $('selectionInfo').textContent = count ? `${count} selected` : '';
    $('deleteSelectedButton').disabled = count === 0;
    $('selectAllCheckbox').checked = count > 0 && count === messages.length;
}

function toggleSelectAll(checked) {
    document.querySelectorAll('.message-checkbox').forEach(c => (c.checked = checked));
    updateSelectionInfo();
}

async function deleteSelectedMessages() {
    const ids = selectedIds();
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} message(s)? This can't be undone.`)) return;
    try {
        const response = await apiFetch('/api/messages', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        if (!response.ok) alert('Failed to delete the selected messages.');
        await reloadCurrentPage();
    } catch (error) {
        alert('An error occurred while deleting the messages.');
    }
}

// --- Send test ---

const MAX_MESSAGE = 1600;
const PHONE_RE = /^\+?[0-9]{6,15}$/;

// Rough SMS segment count: GSM-7 text fits 160 characters (153 per part when split),
// anything outside ASCII forces UCS-2 with 70 (67 per part)
function smsSegments(text) {
    if (!text) return 0;
    const unicode = /[^\x00-\x7F]/.test(text);
    const single = unicode ? 70 : 160;
    const multi = unicode ? 67 : 153;
    return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

function formValues() {
    return {
        sender: $('senderInput').value.trim(),
        phone: $('phoneInput').value.trim(),
        message: $('messageInput').value,
    };
}

function updateMessageCounter() {
    const text = $('messageInput').value;
    const segments = smsSegments(text);
    $('messageCounter').textContent = `${text.length} / ${MAX_MESSAGE}` + (segments ? ` · ${segments} SMS` : '');
}

// Shows the cURL command that would store the same message from outside the dashboard
function updateEquivalentCurl() {
    const { sender, phone, message } = formValues();
    const body = JSON.stringify({ sender: sender || undefined, phone: phone || '+15551234567', message: message || 'Your OTP is 123456' }, null, 2)
        .replace(/'/g, `'\\''`)
        .split('\n')
        .map((line, i) => (i === 0 ? line : `  ${line}`))
        .join('\n');
    $('equivalentCurl').textContent = [
        `curl -X POST ${location.origin}/api/messages \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "X-API-Key: $API_KEY" \\',
        `  -d '${body}'`,
    ].join('\n');
}

function setFieldError(field, message) {
    $(`${field}Error`).textContent = message || '';
    $(`${field}Input`).classList.toggle('invalid', Boolean(message));
}

function clearFieldErrors() {
    ['sender', 'phone', 'message'].forEach(field => setFieldError(field, ''));
}

// Same rules as the server, so most mistakes are caught before sending
function validateForm({ sender, phone, message }) {
    const errors = {};
    if (sender.length > 64) errors.sender = 'At most 64 characters.';
    if (!PHONE_RE.test(phone.replace(/[\s\-.()]/g, ''))) errors.phone = '6–15 digits, optional leading +.';
    if (!message.trim()) errors.message = 'Enter a message.';
    else if (message.length > MAX_MESSAGE) errors.message = `At most ${MAX_MESSAGE} characters.`;
    return errors;
}

function setFormStatus(text, kind) {
    $('formStatus').textContent = text;
    $('formStatus').className = `form-status${kind ? ` ${kind}` : ''}`;
}

function fillSampleOtp() {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    if (!$('senderInput').value) $('senderInput').value = 'MyApp';
    if (!$('phoneInput').value) $('phoneInput').value = '+15551234567';
    $('messageInput').value = `Your verification code is ${otp}. It expires in 10 minutes.`;
    clearFieldErrors();
    onFormInput();
}

function onFormInput() {
    updateMessageCounter();
    updateEquivalentCurl();
}

function clearForm() {
    $('messageForm').reset();
    clearFieldErrors();
    setFormStatus('');
    onFormInput();
}

async function sendMessage(event) {
    event.preventDefault();
    const values = formValues();
    clearFieldErrors();
    const errors = validateForm(values);
    if (Object.keys(errors).length) {
        Object.entries(errors).forEach(([field, msg]) => setFieldError(field, msg));
        setFormStatus('Fix the highlighted fields.', 'error');
        return;
    }

    const button = $('sendButton');
    button.disabled = true;
    setFormStatus('Sending…');
    try {
        const response = await apiFetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
        });
        const data = await response.json().catch(() => ({}));
        $('lastResponse').textContent = `HTTP ${response.status}\n${JSON.stringify(data, null, 2)}`;
        $('lastResponse').classList.remove('muted-code');

        if (response.ok) {
            setFormStatus(`Stored as message #${data.id}.`, 'success');
            $('viewInMessages').classList.remove('hidden');
            selectedId = data.id;
            currentPage = 1;
            // Keep sender and phone so several messages can be sent in a row
            $('messageInput').value = '';
            onFormInput();
            $('messageInput').focus();
        } else if (data.details) {
            // Server messages read like "must be ..." / "is required"; prefix the field name
            Object.entries(data.details).forEach(([field, msg]) => {
                const label = field.charAt(0).toUpperCase() + field.slice(1);
                setFieldError(field, `${label} ${msg}.`);
            });
            setFormStatus('The server rejected the message. See the highlighted fields.', 'error');
        } else {
            setFormStatus(`Failed to send: ${data.error || response.statusText}`, 'error');
        }
    } catch (error) {
        setFormStatus('Could not reach the server.', 'error');
    } finally {
        button.disabled = false;
    }
}

// --- API keys ---

// Full keys revealed on this page, by key id. Only kept while the page is open, and cleared when
// navigating to another view.
const revealedKeys = new Map();
let keysData = { keys: [], adminTokenConfigured: false };

function forgetRevealedKeys() {
    revealedKeys.clear();
    $('newKeyResult').classList.add('hidden');
    $('newKeySecret').textContent = '';
    $('newKeyExample').textContent = '';
}

async function apiJson(url, options = {}) {
    const headers = options.body ? { 'Content-Type': 'application/json' } : {};
    const response = await apiFetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

async function loadKeys() {
    try {
        const { response, data } = await apiJson('/api/keys');
        if (!response.ok) throw new Error(data.error || response.statusText);
        keysData = data;
    } catch (error) {
        keysData = { keys: [], adminTokenConfigured: false };
        $('keysFootnote').textContent = `Could not load API keys: ${error.message}`;
    }
    renderKeys();
}

function keyExample(scope, secret) {
    const base = location.origin;
    if (scope === 'read') {
        return [
            `curl -H "Authorization: Bearer ${secret}" \\`,
            `  "${base}/api/messages/latest?phone=%2B15551234567"`,
        ].join('\n');
    }
    return [
        `curl -X POST ${base}/api/messages \\`,
        '  -H "Content-Type: application/json" \\',
        `  -H "X-API-Key: ${secret}" \\`,
        `  -d '{"phone": "+15551234567", "message": "Your OTP is 123456"}'`,
    ].join('\n');
}

// Fetches (once) and returns a key's full value
async function revealKey(rowId, url) {
    if (revealedKeys.has(rowId)) return revealedKeys.get(rowId);
    const { response, data } = await apiJson(url, { method: 'POST' });
    if (!response.ok) throw new Error(data.error || response.statusText);
    revealedKeys.set(rowId, data.secret);
    return data.secret;
}

function keyRow({ id, name, scope, prefix, source, messageCount, lastUsedAt, createdAt, revokedAt }) {
    const rowId = id;
    const revealUrl = `/api/keys/${id}/reveal`;
    const tr = el('tr', revokedAt ? 'key-revoked' : '');

    const nameCell = el('td', 'key-name');
    nameCell.appendChild(el('span', null, name));
    if (source === 'env') {
        const chip = el('span', 'chip', 'from .env');
        chip.title = 'Imported from INGEST_API_KEYS. It is managed here now: revoking it works even if it is still in .env.';
        nameCell.appendChild(chip);
    }
    tr.appendChild(nameCell);

    const typeCell = el('td');
    typeCell.appendChild(el('span', `scope-badge scope-${scope}`, scope === 'send' ? 'Send' : 'Read'));
    tr.appendChild(typeCell);

    const keyCell = el('td', 'key-value');
    const shown = revealedKeys.get(rowId);
    keyCell.appendChild(el('code', null, shown || `${prefix}…`));
    if (!revokedAt) {
        const actions = el('span', 'key-actions');
        const toggle = el('button', 'ghost small', shown ? 'Hide' : 'Show');
        toggle.type = 'button';
        toggle.addEventListener('click', async () => {
            if (revealedKeys.has(rowId)) {
                revealedKeys.delete(rowId);
                return renderKeys();
            }
            try {
                await revealKey(rowId, revealUrl);
                renderKeys();
            } catch (error) {
                alert(error.message);
            }
        });
        const copy = el('button', 'ghost small', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            try {
                copyText(await revealKey(rowId, revealUrl), copy);
            } catch (error) {
                alert(error.message);
            }
        });
        actions.append(toggle, copy);
        keyCell.appendChild(actions);
    }
    tr.appendChild(keyCell);

    tr.appendChild(el('td', 'num', String(messageCount || 0)));
    tr.appendChild(el('td', 'muted', lastUsedAt ? formatMessageTime(lastUsedAt) : 'Never'));
    tr.appendChild(el('td', 'muted', new Date(createdAt).toLocaleDateString()));

    const actionCell = el('td', 'key-row-action');
    if (revokedAt) {
        actionCell.appendChild(el('span', 'muted', `Revoked ${new Date(revokedAt).toLocaleDateString()}`));
    } else {
        const revoke = el('button', 'danger-ghost small', 'Revoke');
        revoke.type = 'button';
        revoke.addEventListener('click', () => revokeKey(id, name));
        actionCell.appendChild(revoke);
    }
    tr.appendChild(actionCell);
    return tr;
}

function renderKeys() {
    const body = $('keysBody');
    body.replaceChildren();
    const rows = keysData.keys; // active first, then revoked (sorted by the server)
    rows.forEach(row => body.appendChild(keyRow(row)));
    $('keysEmpty').classList.toggle('hidden', rows.length > 0);
    document.querySelector('.keys-table').classList.toggle('hidden', rows.length === 0);
    $('keysFootnote').textContent = keysData.adminTokenConfigured
        ? 'ADMIN_TOKEN from .env also gives full API access (including deleting messages). It is not shown here.'
        : '';
}

function showKeyForm(visible) {
    $('newKeyForm').classList.toggle('hidden', !visible);
    $('newKeyButton').classList.toggle('hidden', visible);
    $('keyNameError').textContent = '';
    $('keyNameInput').classList.remove('invalid');
    if (visible) {
        $('newKeyResult').classList.add('hidden');
        $('keyNameInput').focus();
    } else {
        $('newKeyForm').reset();
    }
}

async function createKey(event) {
    event.preventDefault();
    const name = $('keyNameInput').value.trim();
    const scope = $('keyScopeInput').value;
    if (!name) {
        $('keyNameError').textContent = 'Give the key a name, e.g. the app that will use it.';
        $('keyNameInput').classList.add('invalid');
        return;
    }
    $('createKeyButton').disabled = true;
    try {
        const { response, data } = await apiJson('/api/keys', { method: 'POST', body: JSON.stringify({ name, scope }) });
        if (!response.ok) {
            const message = data.details ? Object.entries(data.details).map(([field, msg]) => `${field === 'name' ? 'Name' : 'Type'} ${msg}.`).join(' ') : data.error;
            $('keyNameError').textContent = message || 'Could not create the key.';
            $('keyNameInput').classList.add('invalid');
            return;
        }
        revealedKeys.set(data.key.id, data.secret);
        showKeyForm(false);
        $('newKeyName').textContent = data.key.name;
        $('newKeySecret').textContent = data.secret;
        $('newKeyExample').textContent = keyExample(data.key.scope, data.secret);
        $('newKeyResult').classList.remove('hidden');
        await loadKeys();
    } catch (error) {
        $('keyNameError').textContent = 'Could not reach the server.';
    } finally {
        $('createKeyButton').disabled = false;
    }
}

async function revokeKey(id, name) {
    if (!confirm(`Revoke "${name}"?\n\nAnything using this key stops working immediately. This can't be undone.`)) return;
    const { response, data } = await apiJson(`/api/keys/${id}`, { method: 'DELETE' });
    if (!response.ok) alert(data.error || 'Could not revoke the key.');
    revealedKeys.delete(id);
    await loadKeys();
}

// --- API reference ---

function renderApiReference() {
    const base = location.origin;
    const endpoint = $('sendEndpoint');
    endpoint.textContent = `${base}/api/messages`;
    endpoint.title = endpoint.textContent;
    $('curlSend').textContent = [
        `curl -X POST ${base}/api/messages \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "X-API-Key: $API_KEY" \\',
        "  -d '{",
        '    "sender": "MyApp",',
        '    "phone": "+15551234567",',
        '    "message": "Your OTP is 123456"',
        "  }'",
    ].join('\n');
    $('curlLatest').textContent = [
        'curl -H "Authorization: Bearer $ADMIN_TOKEN" \\',
        `  "${base}/api/messages/latest?phone=%2B15551234567"`,
    ].join('\n');
    $('jsLatest').textContent = [
        `const res = await fetch('${base}/api/messages/latest?phone=%2B15551234567', {`,
        '  headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },',
        '});',
        'const { code, message } = await res.json(); // code: the detected OTP, or null',
    ].join('\n');
}

// --- Wiring ---

window.addEventListener('DOMContentLoaded', () => {
    setSidebarCollapsed(readSetting('sms_sidebar_collapsed', 'no') === 'yes');
    renderApiReference();
    onFormInput();

    $('collapseButton').addEventListener('click', () => setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed')));
    $('logoutButton').addEventListener('click', logout);

    // Messages
    $('searchButton').addEventListener('click', filterMessages);
    $('searchInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') filterMessages();
    });
    $('startDate').addEventListener('change', onDateChange);
    $('endDate').addEventListener('change', onDateChange);
    $('rangeSelect').addEventListener('change', event => setTimeRange(event.target.value));
    $('rangeChip').addEventListener('click', () => setTimeRange('all'));
    initPaneResizer();
    initSidebarResizer();
    $('resetFiltersButton').addEventListener('click', resetFilters);
    $('refreshButton').addEventListener('click', reloadCurrentPage);
    $('prevPage').addEventListener('click', () => changePage(-1));
    $('nextPage').addEventListener('click', () => changePage(1));
    $('pageSizeSelect').addEventListener('change', changePageSize);
    $('selectAllCheckbox').addEventListener('change', event => toggleSelectAll(event.target.checked));
    $('deleteSelectedButton').addEventListener('click', deleteSelectedMessages);
    // Always copies the original text, whatever view is showing
    $('copyMessageButton').addEventListener('click', event => {
        const message = messages.find(m => m.id === selectedId);
        if (message) copyText(message.message || '', event.target);
    });
    $('copyCodeButton').addEventListener('click', event => copyText(event.target.dataset.code, event.target));
    document.addEventListener('keydown', event => {
        if (currentView() !== 'messages' || event.target.matches('input, textarea, select')) return;
        if (event.key === 'ArrowDown' || event.key === 'j') {
            event.preventDefault();
            moveSelection(1);
        } else if (event.key === 'ArrowUp' || event.key === 'k') {
            event.preventDefault();
            moveSelection(-1);
        }
    });

    // Send test
    $('messageForm').addEventListener('submit', sendMessage);
    $('clearFormButton').addEventListener('click', clearForm);
    $('sampleOtpButton').addEventListener('click', fillSampleOtp);
    ['sender', 'phone', 'message'].forEach(field =>
        $(`${field}Input`).addEventListener('input', () => {
            setFieldError(field, '');
            onFormInput();
        })
    );

    // API keys
    $('newKeyButton').addEventListener('click', () => showKeyForm(true));
    $('cancelKeyButton').addEventListener('click', () => showKeyForm(false));
    $('newKeyForm').addEventListener('submit', createKey);
    $('keyNameInput').addEventListener('input', () => {
        $('keyNameError').textContent = '';
        $('keyNameInput').classList.remove('invalid');
    });
    $('copyNewKey').addEventListener('click', event => copyText($('newKeySecret').textContent, event.target));
    $('dismissKeyResult').addEventListener('click', () => $('newKeyResult').classList.add('hidden'));

    // API reference
    document.querySelectorAll('.copy-button').forEach(button =>
        button.addEventListener('click', () => copyText($(button.dataset.copy).textContent, button))
    );

    // Refresh the list when the tab regains focus
    window.addEventListener('focus', () => {
        if (currentView() === 'messages') reloadCurrentPage();
    });

    window.addEventListener('hashchange', showView);
    // Know the role before showing a view, so a viewer never lands on an admin-only page
    loadSession().then(showView);
});
