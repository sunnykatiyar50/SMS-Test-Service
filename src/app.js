require('dotenv').config();
require('./database/initDatabase'); // Use new unified DB initializer

const express = require('express');
const bodyParser = require('body-parser');
const messageRoutes = require('./routes/messageRoutes');
const { logToFile } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 30001;

// Middleware
app.use(bodyParser.json());
app.use(express.static('src/views')); // Serve static files from the views folder

// Routes
app.use('/api/messages', messageRoutes);

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
});

// Start the server
app.listen(PORT, () => {
    // Use your logger if desired
    logToFile(`Server is running on http://localhost:${PORT}`);
});
