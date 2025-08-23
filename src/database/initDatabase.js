require('dotenv').config();
const { logToFile } = require('../utils/logger');

const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
logToFile('DB_TYPE from env:', process.env.DB_TYPE);
logToFile(`Using database type: ${dbType}`);

if (dbType === 'postgres') {
    logToFile('Using PostgreSQL database');
    module.exports = require('./postgres');
} else if (dbType === 'mysql') {
    logToFile('Using MySQL database');
    module.exports = require('./mysql');
} else {
    logToFile('Using SQLite database');
    module.exports = require('./sqlite');
}