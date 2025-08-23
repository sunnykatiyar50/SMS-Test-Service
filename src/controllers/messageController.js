const { logToFile } = require('../utils/logger');

class MessageController {
    constructor(messageModel) {
        this.messageModel = messageModel;
    }

    async sendMessage(req, res) {
        const { sender, phone, message } = req.body;
        logToFile(`Saving message: ${JSON.stringify({ sender, phone, message })}`);
        try {
            const timestamp = new Date().toISOString();
            await this.messageModel.createMessage({ sender, phone, message, timestamp });
            // logToFile('Message saved successfully');
            res.status(201).json({ success: true, message: 'Message sent successfully' });
        } catch (error) {
            logToFile(`Error sending message: ${error}`);
            res.status(500).json({ error: 'Failed to send message' });
        }
    }

    async getMessages(req, res) {
        try {
            const messages = await this.messageModel.getMessages();
            logToFile(`Fetched messages: ${messages.length} records`);
            res.status(200).json(messages);
        } catch (error) {
            logToFile(`Error fetching messages: ${error}`);
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    }
}

module.exports = MessageController;