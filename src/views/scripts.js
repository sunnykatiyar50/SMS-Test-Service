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

// --- Section Visibility and Layout ---

function setSectionVisibility(sectionId, buttonId, visible, showText, hideText, storageKey) {
    const section = document.getElementById(sectionId);
    const button = document.getElementById(buttonId);
    if (!section || !button) return;
    section.classList.toggle('hidden', !visible);
    button.textContent = visible ? hideText : showText;
    localStorage.setItem(storageKey, visible ? 'visible' : 'hidden');
}

function toggleForm() {
    const form = document.getElementById('sendMessageForm');
    const isVisible = !form.classList.contains('hidden');
    setSectionVisibility(
        'sendMessageForm',
        'toggleFormButton',
        !isVisible,
        'Test API Form',
        'Hide Form',
        'sendMessageFormVisible'
    );
    checkAndHideLeftColumn();
}

function toggleApiSettings() {
    const api = document.getElementById('apiSettings');
    const isVisible = !api.classList.contains('hidden');
    setSectionVisibility(
        'apiSettings',
        'toggleApiSettingsButton',
        !isVisible,
        'Show API Settings',
        'Hide API Settings',
        'apiSettingsVisible'
    );
    checkAndHideLeftColumn();
}

function checkAndHideLeftColumn() {
    const leftColumn = document.getElementById('leftColumn');
    const mainContent = document.querySelector('.main-content');
    const hasVisibleContent = Array.from(leftColumn.children).some(
        child => !child.classList.contains('hidden')
    );
    leftColumn.classList.toggle('hidden', !hasVisibleContent);
    mainContent.classList.toggle('no-left-column', !hasVisibleContent);
}

// --- Message Loading and Rendering ---

async function loadMessages(page = 1, pageSizeParam = pageSize, searchInput = '', startDate = '', endDate = '') {
    // Save params to localStorage for reload/focus
    localStorage.setItem('sms_query_params', JSON.stringify({
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
    const params = localStorage.getItem('sms_query_params');
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
}

async function sendMessage(event) {
    event.preventDefault();
    const sender = document.getElementById('senderInput').value;
    const phone = document.getElementById('phoneInput').value;
    const message = document.getElementById('messageInput').value;

    try {
        const response = await apiFetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender, phone, message }),
        });

        if (response.ok) {
            alert('Message sent successfully!');
            currentPage = 1;
            reloadCurrentPage();
        } else {
            const errorData = await response.json().catch(() => ({}));
            const details = errorData.details
                ? '\n' + Object.entries(errorData.details).map(([field, msg]) => `${field} ${msg}`).join('\n')
                : '';
            alert(`Failed to send message: ${errorData.error || response.statusText}${details}`);
        }
    } catch (error) {
        alert('An error occurred while sending the message.');
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
    setSectionVisibility(
        'sendMessageForm',
        'toggleFormButton',
        localStorage.getItem('sendMessageFormVisible') === 'visible',
        'Test API Form',
        'Hide Form',
        'sendMessageFormVisible'
    );
    setSectionVisibility(
        'apiSettings',
        'toggleApiSettingsButton',
        localStorage.getItem('apiSettingsVisible') === 'visible',
        'Show API Settings',
        'Hide API Settings',
        'apiSettingsVisible'
    );
    checkAndHideLeftColumn();

    // Dynamically set API endpoint hostname in API Settings
    document.getElementById('apiEndpoint').textContent = `POST ${location.origin}/api/messages`;

    document.getElementById('toggleFormButton').addEventListener('click', toggleForm);
    document.getElementById('toggleApiSettingsButton').addEventListener('click', toggleApiSettings);
    document.getElementById('logoutButton').addEventListener('click', logout);
    document.getElementById('messageForm').addEventListener('submit', sendMessage);
    document.getElementById('clearFormButton').addEventListener('click', clearForm);
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
