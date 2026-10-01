# SMS Test Service

A mock SMS gateway for testing. Point your application's SMS integration (OTPs, notifications, etc.) at this service instead of a real provider: messages are **not** delivered to any phone — they are stored in a database and shown in a web interface so you can inspect what would have been sent.

Built with Node.js and Express. Messages can be stored in SQLite (default), PostgreSQL, or MySQL.

## Features

- REST API to submit, list, search, and delete messages
- Web interface with a test form, message list, text search, date-range filter, pagination, and bulk delete
- Phone numbers are masked in the list (only the last 4 digits are shown)
- The message list refreshes when the browser tab regains focus
- Application logs written to `logs/app.log`, rotated daily

## Project Structure
```
sms-test-service
├── src
│   ├── app.js                    # Express server entry point
│   ├── controllers
│   │   └── messageController.js
│   ├── database
│   │   ├── initDatabase.js       # Picks the driver based on DB_TYPE
│   │   ├── mysql.js
│   │   ├── postgres.js
│   │   └── sqlite.js
│   ├── models
│   │   └── messageModel.js
│   ├── routes
│   │   └── messageRoutes.js
│   ├── utils
│   │   └── logger.js
│   └── views                     # Web interface (served as static files)
│       ├── index.html
│       ├── scripts.js
│       └── styles.css
├── logs/                         # Created automatically (app.log, app-YYYY-MM-DD.log)
├── sms-db.sqlite                 # Created automatically when using SQLite
├── package.json
├── package-lock.json
├── LICENSE
├── .env                          # Your local config (not committed)
├── sample.env
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later (tested with Node.js 24) and npm
- Optional: a PostgreSQL or MySQL server, if you don't want to use SQLite

## Installation

1. Clone the repository and enter the project directory:
   ```
   git clone <repository-url>
   cd <repository-folder>
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Create your `.env` file from the sample and adjust it as needed (see [Environment Configuration](#environment-configuration)):
   ```
   cp sample.env .env        # macOS / Linux / Git Bash
   copy sample.env .env      # Windows cmd / PowerShell
   ```

## Usage

1. Start the application **from the project root** (the SQLite file and the web interface are resolved relative to the current directory):
   ```
   npm start
   ```
   For development with auto-restart on file changes:
   ```
   npm run dev
   ```

2. Open `http://localhost:3006` in your browser (or whichever `PORT` you set in `.env`). If `PORT` is not set at all, the server falls back to port `30001`.

3. Click **Test API Form** to send a test message, or send messages from your own application through the API. Messages appear in the list, newest first.

## API Endpoints

### `POST /api/messages`

Store a new message. The server adds the timestamp.

Request body (JSON):

| Field     | Type   | Description         |
|-----------|--------|---------------------|
| `sender`  | string | Sender name or number |
| `phone`   | string | Recipient phone number |
| `message` | string | Message text        |

```
curl -X POST http://localhost:3006/api/messages \
  -H "Content-Type: application/json" \
  -d '{"sender": "MyApp", "phone": "15551234567", "message": "Your OTP is 123456"}'
```

Response `201`:
```json
{ "success": true, "message": "Message sent successfully" }
```

### `GET /api/messages`

List messages, newest first, with optional filtering and pagination.

| Query parameter | Default | Description |
|-----------------|---------|-------------|
| `search`        | —       | Only messages whose text contains this value |
| `startDate`     | —       | Only messages on or after this date (`YYYY-MM-DD`) |
| `endDate`       | —       | Only messages on or before this date (`YYYY-MM-DD`, inclusive) |
| `page`          | `1`     | Page number |
| `pageSize`      | `10`    | Messages per page |

```
curl "http://localhost:3006/api/messages?search=OTP&page=1&pageSize=20"
```

Response `200`:
```json
{
  "messages": [
    { "id": 1, "sender": "MyApp", "phone": "15551234567", "message": "Your OTP is 123456", "timestamp": "2026-01-01T10:00:00.000Z" }
  ],
  "totalPages": 1,
  "totalMessages": 1,
  "currentPage": 1
}
```

### `DELETE /api/messages/:id`

Delete a message by its ID.

```
curl -X DELETE http://localhost:3006/api/messages/1
```

Returns `200` if the message was deleted, or `404` if no message has that ID.

## Environment Configuration

Copy `sample.env` to `.env` and adjust the values as needed:

```
# Port Configuration
PORT=3006                # The port your server will run on

# Database Type
DB_TYPE=sqlite           # Database type: sqlite, postgres, or mysql

# PostgreSQL Configuration (uncomment and fill if using Postgres)
# PG_HOST=localhost       # PostgreSQL server host
# PG_PORT=5432            # PostgreSQL server port
# PG_USER=your_pg_user    # PostgreSQL username
# PG_PASSWORD=your_pg_password  # PostgreSQL password
# PG_DATABASE=your_pg_db  # PostgreSQL database name

# MySQL Configuration (uncomment and fill if using MySQL)
# MYSQL_HOST=localhost    # MySQL server host
# MYSQL_PORT=3306         # MySQL server port
# MYSQL_USER=your_mysql_user    # MySQL username
# MYSQL_PASSWORD=your_mysql_password  # MySQL password
# MYSQL_DATABASE=your_mysql_db  # MySQL database name
```

- **PORT**: The port the server listens on. Falls back to `30001` if not set.
- **DB_TYPE**: The database to use: `sqlite` (default), `postgres`, or `mysql`.
- **PG_\***: PostgreSQL connection settings (used when `DB_TYPE=postgres`).
- **MYSQL_\***: MySQL connection settings (used when `DB_TYPE=mysql`).

With SQLite, the database is stored in `sms-db.sqlite` in the directory you start the server from. `sample.env` also contains a `DATABASE_URL` setting, but the application currently ignores it.

For every database type, the `messages` table is created automatically on startup if it doesn't exist. For PostgreSQL and MySQL, the database itself must already exist.

## Troubleshooting

- **The API returns `Failed to fetch messages`:** the app couldn't connect to the database. The console and `logs/app.log` show `Database initialization failed:` followed by the underlying error. Check `DB_TYPE` and the connection settings in `.env`, and make sure the database server is running and reachable. To rule out the database server, set `DB_TYPE=sqlite`.
- **The web page doesn't load, or the SQLite file appears in an unexpected place:** start the server from the project root directory.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for any suggestions or improvements.

## License

This project is licensed under the MIT License.
