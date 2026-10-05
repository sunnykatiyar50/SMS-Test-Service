// Auto-refresh the page only when it comes into focus after being blurred
let shouldRefreshOnFocus = false;
window.addEventListener('blur', () => {
    shouldRefreshOnFocus = true;
});
window.addEventListener('focus', () => {
    if (shouldRefreshOnFocus) {
        shouldRefreshOnFocus = false;
        reloadWithSavedParams();
    }
});
let messages = [];
let currentPage = 1;
let pageSize = 10;
let totalPages = 1;

// --- Utility Functions ---

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

function truncateMessage(message, maxLength = 60) {
    if (!message) return '';
    const singleLine = message.replace(/[\r\n]+/g, ' ').trim();
    if (singleLine.length <= maxLength) return singleLine;
    return singleLine.slice(0, maxLength - 3) + '...';
}

function formatMessageTime(timestamp) {
    const now = new Date();
    const msgDate = new Date(timestamp);
    const diffMs = now - msgDate;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffDay < 1) {
        if (diffHr >= 1) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
        if (diffMin >= 1) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
        return 'Just now';
    } else if (diffDay < 7) {
        return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
    } else {
        return msgDate.toLocaleDateString();
    }
}

// Converts a YYYY-MM-DD value from a date input to an ISO timestamp for local midnight
// (optionally the following midnight, so the end date is inclusive)
function localDayToIso(value, nextDay = false) {
    if (!value) return '';
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d + (nextDay ? 1 : 0)).toISOString();
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// --- Developer Panel (test form + API reference) ---

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

function setPanelVisible(visible) {
    document.getElementById('devPanel').classList.toggle('hidden', !visible);
    document.getElementById('mainContent').classList.toggle('no-panel', !visible);
    const button = document.getElementById('togglePanelButton');
    button.textContent = visible ? 'Hide tools' : 'Show tools';
    button.setAttribute('aria-expanded', String(visible));
    saveSetting('sms_panel_visible', visible ? 'yes' : 'no');
}

function selectTab(name) {
    for (const tab of ['Send', 'Api']) {
        const active = tab.toLowerCase() === name;
        document.getElementById(`tab${tab}`).classList.toggle('active', active);
        document.getElementById(`tab${tab}`).setAttribute('aria-selected', String(active));
        document.getElementById(`panel${tab}`).classList.toggle('hidden', !active);
    }
    saveSetting('sms_panel_tab', name);
}

// Fills the API reference with URLs for this server
function renderApiReference() {
    const base = location.origin;
    const endpoint = document.getElementById('sendEndpoint');
    endpoint.textContent = `${base}/api/messages`;
    endpoint.title = endpoint.textContent;
    document.getElementById('curlSend').textContent = [
        `curl -X POST ${base}/api/messages \\`,
        '  -H "Content-Type: application/json" \\',
        '  -H "X-API-Key: $API_KEY" \\',
        "  -d '{",
        '    "sender": "MyApp",',
        '    "phone": "+15551234567",',
        '    "message": "Your OTP is 123456"',
        "  }'",
    ].join('\n');
    document.getElementById('curlLatest').textContent = [
        'curl -H "Authorization: Bearer $ADMIN_TOKEN" \\',
        `  "${base}/api/messages/latest?phone=%2B15551234567"`,
    ].join('\n');
}

async function copyFromElement(button) {
    const text = document.getElementById(button.dataset.copy).textContent;
    const original = button.textContent;
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
    } catch {
        button.textContent = 'Copy failed';
    }
    setTimeout(() => (button.textContent = original), 1500);
}

// --- Test Form Helpers ---

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

function updateMessageCounter() {
    const text = document.getElementById('messageInput').value;
    const segments = smsSegments(text);
    document.getElementById('messageCounter').textContent =
        `${text.length} / ${MAX_MESSAGE}` + (segments ? ` · ${segments} SMS` : '');
}

function setFieldError(field, message) {
    document.getElementById(`${field}Error`).textContent = message || '';
    document.getElementById(`${field}Input`).classList.toggle('invalid', Boolean(message));
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
    const status = document.getElementById('formStatus');
    status.textContent = text;
    status.className = `form-status${kind ? ` ${kind}` : ''}`;
}

function fillSampleOtp() {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const sender = document.getElementById('senderInput');
    const phone = document.getElementById('phoneInput');
    if (!sender.value) sender.value = 'MyApp';
    if (!phone.value) phone.value = '+15551234567';
    document.getElementById('messageInput').value = `Your verification code is ${otp}. It expires in 10 minutes.`;
    updateMessageCounter();
    clearFieldErrors();
}

// --- Message Loading and Rendering ---

async function loadMessages(page = 1, pageSizeParam = pageSize, searchInput = '', startDate = '', endDate = '') {
    saveSetting('sms_query_params', JSON.stringify({
        page, pageSize: pageSizeParam, searchInput, startDate, endDate
    }));
    try {
        const queryParams = new URLSearchParams({ page, pageSize: pageSizeParam });
        if (searchInput) queryParams.set('search', searchInput);
        if (startDate) queryParams.set('from', localDayToIso(startDate));
        if (endDate) queryParams.set('to', localDayToIso(endDate, true));

        const response = await apiFetch(`/api/messages?${queryParams.toString()}`);
        if (response.ok) {
            const responseData = await response.json();
            messages = responseData.messages || [];
            currentPage = responseData.currentPage || page;
            totalPages = responseData.totalPages || 1;
            renderMessages();
            updatePagination(totalPages, currentPage);
            document.getElementById('messageInfo').textContent = `${responseData.totalMessages} message(s)`;
        } else {
            messages = [];
            renderMessages();
            totalPages = 1;
            updatePagination(totalPages, 1);
        }
    } catch (error) {
        messages = [];
        renderMessages();
    }
}

function renderMessages() {
    const messageList = document.getElementById('messageList');
    messageList.replaceChildren();
    document.getElementById('selectAllCheckbox').checked = false;

    if (!messages || messages.length === 0) {
        messageList.appendChild(el('p', null, 'No messages to display.'));
        openMessageDetails(null);
        return;
    }

    // Built with DOM APIs and textContent: message data is never interpreted as HTML
    messages.forEach((msg, idx) => {
        const li = el('li', 'message-row');
        li.addEventListener('click', event => {
            if (event.target.classList.contains('message-checkbox')) return;
            document.querySelectorAll('.message-row').forEach(row => row.classList.remove('selected'));
            li.classList.add('selected');
            openMessageDetails(msg);
        });

        const checkbox = el('input', 'message-checkbox');
        checkbox.type = 'checkbox';
        checkbox.dataset.id = String(msg.id);
        const checkboxContainer = el('div', 'checkbox-container');
        checkboxContainer.appendChild(checkbox);

        const details = el('div', 'message-details');
        details.appendChild(el('strong', null, msg.timestamp ? formatMessageTime(msg.timestamp) : ''));
        details.appendChild(el('em', 'message-recipient', `Sent to: ${msg.phone || ''}`));

        const content = el('div', 'message-content-container');
        content.appendChild(details);
        content.appendChild(el('div', 'message-text', truncateMessage(msg.message || '', 60)));

        const row = el('div', 'message-row-content');
        row.appendChild(checkboxContainer);
        row.appendChild(content);
        li.appendChild(row);
        messageList.appendChild(li);

        if (idx === 0) {
            li.classList.add('selected');
            openMessageDetails(msg);
        }
    });
}

// --- Message Details ---

function openMessageDetails(message) {
    const sender = message && typeof message.sender === 'string' ? message.sender.trim() : '';
    document.getElementById('selectedMessageTimestamp').textContent =
        message && message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
    document.getElementById('selectedMessagePhone').textContent = (message && message.phone) || '';
    document.getElementById('selectedMessageText').textContent = (message && message.message) || '';
    document.getElementById('selectedMessageTitle').textContent = !message
        ? 'Selected Message'
        : `Sender: ${sender || '<no-sender-specified>'}`;
}

// --- Pagination ---

function updatePagination(total = totalPages, page = currentPage) {
    document.getElementById('prevPage').disabled = page <= 1;
    document.getElementById('nextPage').disabled = page >= total;
    document.getElementById('pageInfo').textContent = `Page ${page} of ${total}`;
}

function currentFilters() {
    return {
        searchInput: document.getElementById('searchInput').value,
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
    };
}

async function reloadCurrentPage() {
    const { searchInput, startDate, endDate } = currentFilters();
    await loadMessages(currentPage, pageSize, searchInput, startDate, endDate);
}

async function changePage(direction) {
    currentPage = Math.min(Math.max(1, currentPage + direction), totalPages);
    await reloadCurrentPage();
}

async function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSizeSelect').value, 10);
    currentPage = 1;
    await reloadCurrentPage();
}

// --- Filtering ---

async function filterMessages() {
    currentPage = 1;
    await reloadCurrentPage();
}

function reloadWithSavedParams() {
    const params = readSetting('sms_query_params', '');
    if (params) {
        try {
            const { page, pageSize: ps, searchInput, startDate, endDate } = JSON.parse(params);
            document.getElementById('searchInput').value = searchInput || '';
            document.getElementById('startDate').value = startDate || '';
            document.getElementById('endDate').value = endDate || '';
            if (ps) {
                pageSize = ps;
                document.getElementById('pageSizeSelect').value = ps;
            }
            loadMessages(page || 1, ps || pageSize, searchInput || '', startDate || '', endDate || '');
            return;
        } catch (e) {
            // fall through: load all
        }
    }
    loadMessages(1, pageSize, '', '', '');
}

// --- Form and Misc ---

function clearForm() {
    document.getElementById('messageForm').reset();
    clearFieldErrors();
    setFormStatus('');
    updateMessageCounter();
}

async function sendMessage(event) {
    event.preventDefault();
    const values = {
        sender: document.getElementById('senderInput').value.trim(),
        phone: document.getElementById('phoneInput').value.trim(),
        message: document.getElementById('messageInput').value,
    };

    clearFieldErrors();
    const errors = validateForm(values);
    if (Object.keys(errors).length) {
        Object.entries(errors).forEach(([field, msg]) => setFieldError(field, msg));
        setFormStatus('Fix the highlighted fields.', 'error');
        return;
    }

    const button = document.getElementById('sendButton');
    button.disabled = true;
    setFormStatus('Sending…');
    try {
        const response = await apiFetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            setFormStatus(`Stored as message #${data.id}.`, 'success');
            // Keep sender and phone so several messages can be sent in a row
            document.getElementById('messageInput').value = '';
            updateMessageCounter();
            currentPage = 1;
            reloadCurrentPage();
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

async function logout() {
    try {
        await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
        window.location.href = '/login.html';
    }
}

// --- Select All and Delete ---

function toggleSelectAll(selectAllCheckbox) {
    document.querySelectorAll('.message-checkbox').forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
}

async function deleteSelectedMessages() {
    const selectedIds = Array.from(document.querySelectorAll('.message-checkbox:checked'))
        .map(checkbox => Number(checkbox.dataset.id));

    if (selectedIds.length === 0) {
        alert('No messages selected for deletion.');
        return;
    }
    if (!confirm(`Delete ${selectedIds.length} message(s)?`)) return;

    try {
        const response = await apiFetch('/api/messages', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds }),
        });
        if (!response.ok) {
            alert('Failed to delete the selected messages.');
        }
        await reloadCurrentPage();
    } catch (error) {
        alert('An error occurred while deleting the messages.');
    }
}

// --- Event Listeners ---

window.addEventListener('DOMContentLoaded', () => {
    setPanelVisible(readSetting('sms_panel_visible', 'yes') === 'yes');
    selectTab(readSetting('sms_panel_tab', 'send') === 'api' ? 'api' : 'send');
    renderApiReference();
    updateMessageCounter();

    document.getElementById('togglePanelButton').addEventListener('click', () =>
        setPanelVisible(document.getElementById('devPanel').classList.contains('hidden'))
    );
    document.getElementById('tabSend').addEventListener('click', () => selectTab('send'));
    document.getElementById('tabApi').addEventListener('click', () => selectTab('api'));
    document.querySelectorAll('.copy-button').forEach(button =>
        button.addEventListener('click', () => copyFromElement(button))
    );
    document.getElementById('logoutButton').addEventListener('click', logout);
    document.getElementById('messageForm').addEventListener('submit', sendMessage);
    document.getElementById('clearFormButton').addEventListener('click', clearForm);
    document.getElementById('sampleOtpButton').addEventListener('click', fillSampleOtp);
    document.getElementById('messageInput').addEventListener('input', updateMessageCounter);
    ['sender', 'phone', 'message'].forEach(field =>
        document.getElementById(`${field}Input`).addEventListener('input', () => setFieldError(field, ''))
    );
    document.getElementById('prevPage').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPage').addEventListener('click', () => changePage(1));
    document.getElementById('pageSizeSelect').addEventListener('change', changePageSize);
    document.getElementById('deleteSelectedButton').addEventListener('click', deleteSelectedMessages);
    document.getElementById('selectAllCheckbox').addEventListener('click', function () {
        toggleSelectAll(this);
    });
    document.getElementById('searchButton').addEventListener('click', async function () {
        const searchBtn = this;
        searchBtn.disabled = true;
        searchBtn.classList.add('button-disabled');
        try {
            await filterMessages();
        } finally {
            searchBtn.disabled = false;
            searchBtn.classList.remove('button-disabled');
        }
    });
    document.getElementById('searchInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') filterMessages();
    });

    // On first visit, show all messages (no filters). If params exist, restore them.
    reloadWithSavedParams();
});
