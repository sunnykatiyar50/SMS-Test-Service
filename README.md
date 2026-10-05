# SMS Test Service

A mock SMS gateway for testing. Point your application's SMS integration (OTPs, notifications, etc.) at this service instead of a real provider: messages are **not** delivered to any phone — they are stored in a database and shown in a web interface so you can inspect what would have been sent.

Built with Node.js and Express. Messages can be stored in SQLite (default), PostgreSQL, or MySQL.

## Features

- REST API to submit, list, search, and delete messages
- API-key authentication for applications that submit messages, and a password-protected dashboard
- Admin token for scripts and E2E tests, including a "latest message for this phone number" endpoint for reading OTPs
- Web interface with a test form, message list, text search (message, phone, and sender), date-range filter, pagination, and bulk delete
- Phone numbers are masked in API responses and the dashboard (only the last 4 digits are shown)
- Input validation, rate limiting, security headers (CSP), and optional automatic cleanup of old messages
- Application logs written to `logs/app.log` and stdout, rotated daily. Message text is never logged.

## Project Structure
```
sms-test-service
├── src
│   ├── app.js                    # Entry point: loads config, connects the database, starts the server
│   ├── server.js                 # Builds the Express app (middleware, routes)
│   ├── config.js                 # Reads and validates environment variables
│   ├── controllers
│   │   └── messageController.js
│   ├── database
│   │   ├── initDatabase.js       # Picks the driver based on DB_TYPE
│   │   ├── mysql.js
│   │   ├── postgres.js
│   │   └── sqlite.js
│   ├── middleware
│   │   ├── auth.js               # API keys, admin token, dashboard sessions
│   │   └── validate.js           # Request validation
│   ├── models
│   │   └── messageModel.js
│   ├── routes
│   │   └── messageRoutes.js
│   ├── utils
│   │   ├── logger.js
│   │   ├── mask.js
│   │   └── session.js            # Signed session cookies
│   └── views                     # Web interface (served as static files)
│       ├── index.html
│       ├── login.html
│       ├── login.js
│       ├── scripts.js
│       └── styles.css
├── test
│   └── api.test.js
├── logs/                         # Created automatically (app.log, app-YYYY-MM-DD.log)
├── sms-db.sqlite                 # Created automatically when using SQLite
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env                          # Your local config (not committed)
├── sample.env
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later (tested with Node.js 24) and npm
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

3. Create your `.env` file from the sample:
   ```
   cp sample.env .env        # macOS / Linux / Git Bash
   copy sample.env .env      # Windows cmd / PowerShell
   ```

4. Replace every `change-me` value in `.env`. The server refuses to start while they are still there. To generate a random value:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   See [Environment Configuration](#environment-configuration) for all settings.

## Usage

1. Start the application **from the project root** (the default SQLite file path is relative to the current directory):
   ```
   npm start
   ```
   For development with auto-restart on file changes:
   ```
   npm run dev
   ```

2. Open `http://localhost:3006` in your browser (or whichever `PORT` you set) and sign in with `ADMIN_PASSWORD`.

3. Click **Test API Form** to send a test message, or send messages from your own application through the API with an `X-API-Key` header. Messages appear in the list, newest first.

To run the tests:
```
npm test
```

## Authentication

| Who | How | Can do |
|-----|-----|--------|
| Applications sending SMS | `X-API-Key: <key>` header, using one of the keys in `INGEST_API_KEYS` | `POST /api/messages` only |
| Scripts and E2E tests | `Authorization: Bearer <ADMIN_TOKEN>` header | Everything |
| People using the dashboard | Sign in with `ADMIN_PASSWORD` (sets an HttpOnly session cookie) | Everything |

Each API key has a name (`INGEST_API_KEYS=web:key1,mobile:key2`). The name is stored with every message the key submits and returned as `apiKeyName`. Messages sent from the dashboard test form are stored as `dashboard`.

To turn off authentication completely for local development, set `AUTH_DISABLED=true`. Don't do this on a server other people can reach.

## Running with Docker

Requires Docker with the Compose plugin. Set `INGEST_API_KEYS`, `ADMIN_PASSWORD`, and `SESSION_SECRET` in `.env` first. Compose refuses to start without them.

With SQLite (default):
```
docker compose up --build
```

With a bundled PostgreSQL container:
```
DB_TYPE=postgres docker compose --profile postgres up --build
```

The service is available at `http://localhost:3006`. Set `PORT` to publish it on a different host port. Messages and logs are kept in the `sms-data` and `sms-logs` volumes (PostgreSQL data in `pg-data`), so they survive container restarts. To delete them, run `docker compose down -v`.

Docker Compose reads the `.env` file in the project directory. Inside Compose, `PG_HOST` is always the bundled `postgres` service.

To build and run the image without Compose:
```
docker build -t sms-test-service .
docker run -d -p 3006:3006 -v sms-data:/app/data --env-file .env --name sms-test-service sms-test-service
```

To use a database running on your machine from the container, set the host to `host.docker.internal` (for example `-e DB_TYPE=mysql -e MYSQL_HOST=host.docker.internal ...`), not `localhost`.

If you put the service behind a reverse proxy (nginx, Traefik, etc.), set `TRUST_PROXY=1` so rate limiting sees real client IPs and session cookies are marked `Secure` over HTTPS.

## API Endpoints

Errors are returned as JSON: `{ "error": "..." }`. Validation errors also include a `details` object keyed by field.

### `POST /api/messages`

Store a new message. The server adds the timestamp. Requires `X-API-Key`.

Request body (JSON):

| Field     | Type   | Description |
|-----------|--------|-------------|
| `sender`  | string | Optional. Sender name or number, at most 64 characters |
| `phone`   | string | Required. Recipient phone number: 6–15 digits with an optional leading `+`. Spaces, dashes, dots, and brackets are removed. |
| `message` | string | Required. Message text, at most 1600 characters |

```
curl -X POST http://localhost:3006/api/messages \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"sender": "MyApp", "phone": "15551234567", "message": "Your OTP is 123456"}'
```

Response `201`:
```json
{ "success": true, "id": 42, "timestamp": "2026-01-01T10:00:00.000Z", "message": "Message sent successfully" }
```

Returns `400` for invalid input, `401` for a missing or wrong API key, and `429` when the rate limit (`INGEST_RATE_LIMIT` per minute per IP) is exceeded.

### `GET /api/messages`

List messages, newest first, with optional filtering and pagination. Requires admin authentication.

| Query parameter | Default | Description |
|-----------------|---------|-------------|
| `search`        | —       | Only messages whose text, phone number, or sender contains this value (case-insensitive) |
| `phone`         | —       | Only messages sent to exactly this phone number |
| `startDate`     | —       | Only messages on or after this date (`YYYY-MM-DD`, UTC) |
| `endDate`       | —       | Only messages on or before this date (`YYYY-MM-DD`, UTC, inclusive) |
| `from` / `to`   | —       | ISO date-times; used instead of `startDate` / `endDate` when given (`to` is exclusive) |
| `page`          | `1`     | Page number |
| `pageSize`      | `10`    | Messages per page, 1–100 |
| `unmask`        | `false` | `true` returns full phone numbers |

```
curl -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3006/api/messages?search=OTP&page=1&pageSize=20"
```

Response `200`:
```json
{
  "messages": [
    { "id": 1, "sender": "MyApp", "phone": "*******4567", "message": "Your OTP is 123456", "timestamp": "2026-01-01T10:00:00.000Z", "apiKeyName": "myapp" }
  ],
  "totalPages": 1,
  "totalMessages": 1,
  "currentPage": 1
}
```

### `GET /api/messages/latest`

Return the newest message that matches the same filters as `GET /api/messages` (usually `phone`), or `404` if there is none. Requires admin authentication. This is handy in E2E tests to read the OTP your application just sent:

```
curl -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3006/api/messages/latest?phone=15551234567"
```

```js
// Playwright / Cypress / Jest example
const res = await fetch(`${SMS_URL}/api/messages/latest?phone=15551234567`, {
  headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
});
const { message } = await res.json();
const otp = message.match(/\b\d{6}\b/)[0];
```

### `DELETE /api/messages/:id`

Delete a message by its ID. Requires admin authentication.

```
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3006/api/messages/1
```

Returns `200` if the message was deleted, or `404` if no message has that ID.

### `DELETE /api/messages`

Delete several messages at once (up to 500). Requires admin authentication.

```
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"ids": [1, 2, 3]}' http://localhost:3006/api/messages
```

Response `200`: `{ "message": "Messages deleted successfully.", "deleted": 3 }`

### `GET /health`

Public. Returns `{ "status": "ok" }` when the database is reachable, `503` otherwise. Used by the Docker health check.

## Environment Configuration

See `sample.env` for a commented template.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3006` | Port the server listens on |
| `INGEST_API_KEYS` | — | Required. Comma-separated `name:key` pairs accepted in `X-API-Key`. Keys must be at least 16 characters. |
| `ADMIN_PASSWORD` | — | Required. Dashboard password |
| `SESSION_SECRET` | — | Required. At least 32 characters; signs session cookies |
| `ADMIN_TOKEN` | — | Optional bearer token for scripts and tests (at least 16 characters) |
| `SESSION_TTL_HOURS` | `12` | How long a dashboard sign-in lasts |
| `AUTH_DISABLED` | `false` | `true` turns off all authentication (local development only) |
| `TRUST_PROXY` | — | Number of reverse-proxy hops in front of the service (e.g. `1`) |
| `INGEST_RATE_LIMIT` | `120` | Max `POST /api/messages` requests per minute per client IP |
| `RETENTION_DAYS` | `0` | Delete messages older than this many days, checked hourly (`0` keeps everything) |
| `LOG_DIR` | `./logs` | Directory for log files |
| `DB_TYPE` | `sqlite` | `sqlite`, `postgres`, or `mysql` |
| `SQLITE_PATH` | `./sms-db.sqlite` | SQLite database file (the Docker image uses `/app/data/sms-db.sqlite`) |
| `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` | — | PostgreSQL connection settings |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | — | MySQL connection settings |

For every database type, the `messages` table is created automatically on startup if it doesn't exist, and older tables get the new `api_key_name` column added. For PostgreSQL and MySQL, the database itself must already exist.

## Upgrading from 1.x

- Authentication is now required. Add `INGEST_API_KEYS`, `ADMIN_PASSWORD`, and `SESSION_SECRET` to `.env`, and send `X-API-Key` from your applications. Use `AUTH_DISABLED=true` if you need the old open behaviour on a local machine.
- `GET /api/messages` returns masked phone numbers unless you pass `unmask=true`.
- The default port when `PORT` isn't set is now `3006` (previously `30001`).
- The unused `DATABASE_URL` setting has been removed.

## Troubleshooting

- **The server exits with `Invalid auth configuration`:** one of the required auth settings is missing, too short, or still a `change-me` placeholder. The message lists what to fix.
- **The server exits with `Startup failed`:** usually the database connection. Check `DB_TYPE` and the connection settings in `.env`, and make sure the database server is running and reachable. To rule out the database server, set `DB_TYPE=sqlite`.
- **`401 Invalid API key`:** the `X-API-Key` value doesn't match any key in `INGEST_API_KEYS`. Restart the server after changing `.env`.
- **Every client shares one rate limit behind a proxy:** set `TRUST_PROXY=1`.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for any suggestions or improvements.

## License

This project is licensed under the MIT License.
