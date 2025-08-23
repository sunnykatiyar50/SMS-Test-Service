const express = require('express');
const router = express.Router();
const MessageController = require('../controllers/messageController');
const messageModel = require('../models/messageModel');

const messageController = new MessageController(messageModel);

// Route to handle POST requests for sending a message
router.post('/', (req, res) => messageController.sendMessage(req, res));

// Route to handle GET requests for retrieving all messages
router.get('/', async (req, res) => {
    try {
        const { search = '', startDate, endDate, page = 1, pageSize = 10 } = req.query; // Extract query parameters
        console.log(`[${new Date().toLocaleString()}] Search Parameters:`, { search, startDate, endDate, page, pageSize }); // Debugging log

        // Fetch filtered messages from the database
        const allMessages = await messageModel.getMessages({ search, startDate, endDate });
        console.log(`[${new Date().toLocaleString()}] Fetched messages:`, allMessages.length);
        // Pagination logic
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const size = Math.max(1, parseInt(pageSize, 10) || 10);
        const totalMessages = allMessages.length;
        const totalPages = Math.max(1, Math.ceil(totalMessages / size));
        const startIdx = (pageNum - 1) * size;
        const endIdx = startIdx + size;
        console.log(`[${new Date().toLocaleString()}] Pagination: pageNum=${pageNum}, size=${size}, startIdx=${startIdx}, endIdx=${endIdx}, totalMessages=${totalMessages}, totalPages=${totalPages}`);
        const paginatedMessages = allMessages.slice(startIdx, endIdx);

        res.status(200).json({
            messages: paginatedMessages,
            totalPages,
            totalMessages,
            currentPage: pageNum
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Route to delete a message by ID
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await messageModel.deleteMessage(id);
        console.log("deleted message with id: ",id);
        if (result) {
            res.status(200).json({ message: 'Message deleted successfully.' });
        } else {
            res.status(404).json({ error: 'Message not found.' });
        }
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message.' });
    }
});

module.exports = router;