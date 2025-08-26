let messages = [];
let filteredMessages = [];
let currentPage = 1;
let pageSize = 10;
let totalPages = 1;

// --- Utility Functions ---

function maskPhoneNumber(phone) {
    if (phone.length > 4) {
        return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
    }
    return phone;
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

function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
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
        'Show Form',
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
    if (!hasVisibleContent) {
        leftColumn.classList.add('hidden');
        mainContent.classList.add('no-left-column');
    } else {
        leftColumn.classList.remove('hidden');
        mainContent.classList.remove('no-left-column');
    }
}

// --- Message Loading and Rendering ---

async function loadMessages(page = 1, pageSizeParam = pageSize, searchInput = '', startDate = '', endDate = '') {
    try {
        const queryParams = new URLSearchParams({
            page,
            pageSize: pageSizeParam,
            search: searchInput,
            startDate,
            endDate,
        });
        const response = await fetch(`/api/messages?${queryParams.toString()}`);
        if (response.ok) {
            const responseData = await response.json();
            messages = responseData.messages || [];
            filteredMessages = messages;
            // Always update currentPage and totalPages with backend's value
            currentPage = responseData.currentPage || page;
            totalPages = responseData.totalPages || 1;
            console.log('Frontend pagination:', { currentPage, totalPages, messages: messages.length });
            renderMessages();
            updatePagination(totalPages, currentPage);
        } else {
            filteredMessages = [];
            renderMessages();
            totalPages = 1;
            updatePagination(totalPages, 1);
        }
    } catch (error) {
        filteredMessages = [];
        renderMessages();
    }
}

function renderMessages() {

    const messageList = document.getElementById('messageList');
    messageList.innerHTML = '';

    console.log('renderMessages filteredMessages:', filteredMessages);

    if (!filteredMessages || filteredMessages.length === 0) {
        messageList.innerHTML = '<p>No messages to display.</p>';
        return;
    }

    let firstRowLi = null;

    filteredMessages.forEach((msg, idx) => {
        // Defensive: handle null or missing fields
        const sender = msg.sender || '';
        const phone = msg.phone || '';
        const message = msg.message || '';
        const timestamp = msg.timestamp || '';
        const li = document.createElement('li');
        li.classList.add('message-row');
        li.addEventListener('click', () => {
            document.querySelectorAll('.message-row').forEach(row => row.classList.remove('selected'));
            li.classList.add('selected');
            openMessageDetails(msg);
        });

        const formattedTime = timestamp ? formatMessageTime(timestamp) : '';

        li.innerHTML = `
            <div class="message-row-content">
                <div class="checkbox-container">
                    <input type="checkbox" class="message-checkbox" data-id="${msg.id || ''}" />
                </div>
                <div class="message-content-container">
                    <div class="message-details">
                        <strong>${formattedTime}</strong>
                        <em style="margin-left:24px;">Sent to: ${maskPhoneNumber(phone)}</em>
                    </div>
                    <div class="message-text">${truncateMessage(message, 60)}</div>
                </div>
            </div>`;
        messageList.appendChild(li);

        if (idx === 0) firstRowLi = li;
    });

    if (firstRowLi) {
        firstRowLi.classList.add('selected');
        openMessageDetails(filteredMessages[0]);
    }
}

// --- Message Details and Modal ---

function openMessageDetails(message) {
    const selectedMessageTimestamp = document.getElementById('selectedMessageTimestamp');
    const selectedMessagePhone = document.getElementById('selectedMessagePhone');
    const selectedMessageText = document.getElementById('selectedMessageText');
    const selectedMessageTitle = document.getElementById('selectedMessageTitle');
    const timestamp = message && message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
    const phone = message && message.phone ? maskPhoneNumber(message.phone) : '';
    const msgText = message && message.message ? message.message : '';
    let sender = '';
    if (message && typeof message.sender === 'string' && message.sender.trim() !== '') {
        sender = message.sender;
    }
    selectedMessageTimestamp.textContent = timestamp;
    selectedMessagePhone.textContent = phone;
    selectedMessageText.textContent = msgText;
    selectedMessageTitle.textContent = sender ? `Sender: ${sender}` : 'Sender: <no-sender-specified>';
}

function openMessageModal(message) {
    const modal = document.getElementById('messageModal');
    const modalContent = document.getElementById('modalMessageContent');
    modalContent.textContent = message;
    modal.classList.remove('hidden');
    modal.style.display = 'block';
}

function closeMessageModal() {
    const modal = document.getElementById('messageModal');
    modal.style.display = 'none';
}

// --- Pagination ---

function updatePagination(totalPages = Math.ceil(filteredMessages.length / pageSize), page = currentPage) {
    document.getElementById('prevPage').disabled = page === 1;
    document.getElementById('nextPage').disabled = page === totalPages || totalPages === 0;
    document.getElementById('pageInfo').textContent = `Page ${page} of ${totalPages}`;
}

async function changePage(direction) {
    let newPage = currentPage + direction;
    if (newPage < 1) newPage = 1;
    if (newPage > totalPages) newPage = totalPages;
    currentPage = newPage;
    const searchInput = document.getElementById('searchInput').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    await loadMessages(currentPage, pageSize, searchInput, startDate, endDate);
}

async function changePageSize() {
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    pageSize = parseInt(pageSizeSelect.value, 10);
    currentPage = 1;
    const searchInput = document.getElementById('searchInput').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    await loadMessages(currentPage, pageSize, searchInput, startDate, endDate);
}

// --- Filtering ---

async function filterMessages() {
    const searchInput = document.getElementById('searchInput').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    currentPage = 1;
    await loadMessages(currentPage, pageSize, searchInput, startDate, endDate);
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
        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender, phone, message }),
        });

        if (response.ok) {
            alert('Message sent successfully!');
            loadMessages();
        } else {
            const errorData = await response.json();
            alert(`Failed to send message: ${errorData.error}`);
        }
    } catch (error) {
        alert('An error occurred while sending the message.');
    }
}

// --- Select All and Delete ---

function toggleSelectAll(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll('.message-checkbox');
    checkboxes.forEach((checkbox) => {
        checkbox.checked = selectAllCheckbox.checked;
    });
}

async function deleteSelectedMessages() {
    const checkboxes = document.querySelectorAll('.message-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(checkbox => checkbox.dataset.id);

    if (selectedIds.length === 0) {
        alert('No messages selected for deletion.');
        return;
    }

    try {
        const deletePromises = selectedIds.map(id =>
            fetch(`/api/messages/${id}`, { method: 'DELETE' })
        );
        const responses = await Promise.all(deletePromises);
        const failedDeletions = responses.filter(response => !response.ok);
        if (failedDeletions.length > 0) {
            alert(`Failed to delete ${failedDeletions.length} messages.`);
        } else {
            alert('Selected messages have been deleted successfully.');
        }
        filteredMessages = filteredMessages.filter(msg => !selectedIds.includes(msg.id.toString()));
        messages = messages.filter(msg => !selectedIds.includes(msg.id.toString()));
        renderMessages();
        document.getElementById('selectAllCheckbox').checked = false;
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
        'Hide Test API Form',
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
    const apiEndpoint = document.getElementById('apiEndpoint');
    if (apiEndpoint) {
        const port = location.port ? ':' + location.port : '';
        apiEndpoint.textContent = `POST ${location.protocol}//${location.hostname}${port}/api/messages`;
    }
});



window.onload = () => {
    // Do not set default dates; show all messages by default
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    document.getElementById('searchInput').value = '';
    loadMessages(1, pageSize, '', '', '');
    updateButtonText();
};



function updateButtonText() {
    const formContainer = document.getElementById('sendMessageForm');
    const apiSettings = document.getElementById('apiSettings');
    const toggleFormButton = document.getElementById('toggleFormButton');
    const toggleApiSettingsButton = document.getElementById('toggleApiSettingsButton');
    toggleFormButton.textContent = formContainer.classList.contains('hidden') ? 'Test API Form' : 'Hide Form';
    toggleApiSettingsButton.textContent = apiSettings.classList.contains('hidden') ? 'Show API Settings' : 'Hide API Settings';
}

// Attach event listeners

document.getElementById('searchButton').addEventListener('click', async function() {
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
document.getElementById('deleteSelectedButton').addEventListener('click', deleteSelectedMessages);
document.getElementById('selectAllCheckbox').addEventListener('click', function() { toggleSelectAll(this); });
document.getElementById('closeModal').addEventListener('click', closeMessageModal);
window.addEventListener('click', event => {
    const modal = document.getElementById('messageModal');
    if (event.target === modal) closeMessageModal();
});

// --- End of scripts.js ---