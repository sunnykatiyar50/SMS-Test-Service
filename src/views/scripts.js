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

// First 4-8 digit number in a message, e.g. an OTP
function extractCode(text) {
    const match = (text || '').match(/\b\d{4,8}\b/);
    return match ? match[0] : null;
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

const VIEWS = ['messages', 'send', 'api'];
const VIEW_TITLES = { messages: 'Messages', send: 'Send test', api: 'API reference' };

function currentView() {
    const name = location.hash.replace(/^#\/?/, '');
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
}

function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    const button = $('collapseButton');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    button.querySelector('.label').textContent = collapsed ? 'Expand' : 'Collapse';
    saveSetting('sms_sidebar_collapsed', collapsed ? 'yes' : 'no');
}

async function loadSession() {
    try {
        const response = await fetch('/auth/status');
        const status = await response.json();
        $('currentUser').textContent = status.username || (status.authDisabled ? 'No sign-in' : 'admin');
        $('authWarning').classList.toggle('hidden', !status.authDisabled);
        $('logoutButton').classList.toggle('hidden', Boolean(status.authDisabled));
    } catch {
        // keep defaults
    }
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
    saveSetting('sms_query_params', JSON.stringify({ page, pageSize: pageSizeParam, searchInput, startDate, endDate }));
    try {
        const queryParams = new URLSearchParams({ page, pageSize: pageSizeParam });
        if (searchInput) queryParams.set('search', searchInput);
        if (startDate) queryParams.set('from', localDayToIso(startDate));
        if (endDate) queryParams.set('to', localDayToIso(endDate, true));

        const response = await apiFetch(`/api/messages?${queryParams.toString()}`);
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        messages = data.messages || [];
        currentPage = data.currentPage || page;
        totalPages = data.totalPages || 1;
        const filtered = Boolean(searchInput || startDate || endDate);
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
        const filtered = Object.values(currentFilters()).some(Boolean);
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
        const checkWrap = el('label', 'row-check');
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
        body.appendChild(el('div', 'row-text', truncateMessage(msg.message)));

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
    $('selectedMessageText').textContent = message.message || '';

    const code = extractCode(message.message);
    $('copyCodeButton').classList.toggle('hidden', !code);
    $('copyCodeButton').textContent = code ? `Copy code ${code}` : 'Copy code';
    $('copyCodeButton').dataset.code = code || '';
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
    await filterMessages();
}

function reloadWithSavedParams() {
    try {
        const saved = JSON.parse(readSetting('sms_query_params', 'null'));
        if (saved) {
            $('searchInput').value = saved.searchInput || '';
            $('startDate').value = saved.startDate || '';
            $('endDate').value = saved.endDate || '';
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
        'const { message } = await res.json();',
        'const otp = message.match(/\\b\\d{6}\\b/)[0];',
    ].join('\n');
}

// --- Wiring ---

window.addEventListener('DOMContentLoaded', () => {
    setSidebarCollapsed(readSetting('sms_sidebar_collapsed', 'no') === 'yes');
    loadSession();
    renderApiReference();
    onFormInput();

    $('collapseButton').addEventListener('click', () => setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed')));
    $('logoutButton').addEventListener('click', logout);

    // Messages
    $('searchButton').addEventListener('click', filterMessages);
    $('searchInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') filterMessages();
    });
    $('startDate').addEventListener('change', filterMessages);
    $('endDate').addEventListener('change', filterMessages);
    $('resetFiltersButton').addEventListener('click', resetFilters);
    $('refreshButton').addEventListener('click', reloadCurrentPage);
    $('prevPage').addEventListener('click', () => changePage(-1));
    $('nextPage').addEventListener('click', () => changePage(1));
    $('pageSizeSelect').addEventListener('change', changePageSize);
    $('selectAllCheckbox').addEventListener('change', event => toggleSelectAll(event.target.checked));
    $('deleteSelectedButton').addEventListener('click', deleteSelectedMessages);
    $('copyMessageButton').addEventListener('click', event => copyText($('selectedMessageText').textContent, event.target));
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

    // API reference
    document.querySelectorAll('.copy-button').forEach(button =>
        button.addEventListener('click', () => copyText($(button.dataset.copy).textContent, button))
    );

    // Refresh the list when the tab regains focus
    window.addEventListener('focus', () => {
        if (currentView() === 'messages') reloadCurrentPage();
    });

    window.addEventListener('hashchange', showView);
    showView();
});
