const { logToFile } = require('../utils/logger');
const { maskPhoneNumber } = require('../utils/mask');

// Only metadata is logged; message bodies (often OTPs) never reach the log file
const describe = ({ phone, message }) => `phone=${maskPhoneNumber(phone)} length=${message.length}`;

class MessageController {
    constructor(messageModel) {
        this.messageModel = messageModel;
    }

    present(message, unmask) {
        return unmask ? message : { ...message, phone: maskPhoneNumber(message.phone) };
    }

    async sendMessage(req, res) {
        const { sender, phone, message } = req.validated;
        const apiKeyName = req.auth.apiKeyName;
        const { id, timestamp } = await this.messageModel.create({ sender, phone, message, apiKeyName });
        logToFile(`Stored message id=${id} key=${apiKeyName} ${describe({ phone, message })}`);
        res.status(201).json({ success: true, id, timestamp, message: 'Message sent successfully' });
    }

    async getMessages(req, res) {
        const { page, pageSize, filters, unmask } = req.listQuery;
        const { total, messages } = await this.messageModel.list({
            ...filters,
            limit: pageSize,
            offset: (page - 1) * pageSize,
        });
        res.status(200).json({
            messages: messages.map(m => this.present(m, unmask)),
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            totalMessages: total,
            currentPage: page,
        });
    }

    async getLatestMessage(req, res) {
        const { filters, unmask } = req.listQuery;
        const message = await this.messageModel.latest(filters);
        if (!message) return res.status(404).json({ error: 'No matching message found.' });
        res.status(200).json(this.present(message, unmask));
    }

    async deleteMessages(req, res) {
        const { ids } = req.validated;
        const deleted = await this.messageModel.deleteMany(ids);
        logToFile(`Deleted ${deleted} message(s): ${ids.join(', ')}`);
        if (req.params.id !== undefined && deleted === 0) {
            return res.status(404).json({ error: 'Message not found.' });
        }
        res.status(200).json({ message: 'Messages deleted successfully.', deleted });
    }
}

module.exports = MessageController;
