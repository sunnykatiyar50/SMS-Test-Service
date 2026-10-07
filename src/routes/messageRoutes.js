const express = require('express');
const rateLimit = require('express-rate-limit');
const MessageController = require('../controllers/messageController');
const {
    validateNewMessage,
    validateListQuery,
    validateIdParam,
    validateIdList,
} = require('../middleware/validate');

function createMessageRoutes({ messageModel, auth, config }) {
    const router = express.Router();
    const controller = new MessageController(messageModel);

    const ingestLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: config.ingestRateLimit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many messages, slow down.' },
    });

    // Submit a message: a Send key (X-API-Key), or an admin (the dashboard test form)
    router.post('/', ingestLimiter, auth.requireIngest, validateNewMessage, (req, res) =>
        controller.sendMessage(req, res)
    );

    // Reading: a Read key, or an admin
    router.get('/', auth.requireRead, validateListQuery, (req, res) => controller.getMessages(req, res));
    router.get('/latest', auth.requireRead, validateListQuery, (req, res) =>
        controller.getLatestMessage(req, res)
    );
    // Deleting: admin only
    router.delete('/', auth.requireAdmin, validateIdList, (req, res) => controller.deleteMessages(req, res));
    router.delete('/:id', auth.requireAdmin, validateIdParam, (req, res) => controller.deleteMessages(req, res));

    return router;
}

module.exports = createMessageRoutes;
