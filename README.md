# SMS Test Service

A mock SMS gateway for testing. Point your application's SMS integration (OTPs, notifications, etc.) at this service instead of a real provider: messages are **not** delivered to any phone — they are stored in a database and shown in a web interface so you can inspect what would have been sent.

Built with Node.js and Express. Messages can be stored in SQLite (default), PostgreSQL, or MySQL.

## Features

- REST API to submit, list, search, and delete messages
- API keys managed in the dashboard: Send keys for apps, Read keys for tests; create, copy, and revoke them without touching the server. The dashboard itself is password-protected
- Admin token for scripts and E2E tests, including a "latest message for this phone number" endpoint for reading OTPs
- Web dashboard with a resizable sidebar for navigation (drag its edge; drag it narrow to collapse it to icons):
  - **Messages**: compact list with search (message, phone, and sender), date filters, pagination, bulk delete, keyboard navigation (↑/↓ or j/k), and a resizable detail pane with one-click "Copy code" for OTPs
  - Messages are shown according to their format, with a switch between views:
    - **JSON**: indented and colour-coded, or raw.
    - **HTML**: a safe preview (scripts and external images blocked), indented source, or raw.
    - **XML**: indented, or raw.
    - **Syslog**: a table with time, host, app, PID and a severity badge (RFC 3164, RFC 5424 and classic `host app[pid]:` lines), or raw.
    - **Plain text**: shown as sent, with clickable links.
  - Quick time range in the sidebar: Last 10 minutes, Last 1 hour, Last 8 hours, Last 1 day, Last 1 week, Last 1 month, or All time
  - **Send test**: test form with validation, SMS segment counter, the raw API response, and the equivalent cURL command
  - **API reference**: endpoints, auth, and copyable examples generated for your server
- Sign-in page with username and password from `.env`
- Light and dark themes: the theme button (sidebar, or the corner of the sign-in page) cycles between System (follows the browser), Light, and Dark, and the choice is remembered
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
│   │   ├── sqlite.js             # Node's built-in node:sqlite
│   │   └── ssl.js                # PG_SSL / MYSQL_SSL options
│   ├── middleware
│   │   ├── auth.js               # Dashboard sessions, API keys (Send/Read), ADMIN_TOKEN
│   │   └── validate.js           # Request validation
│   ├── models
│   │   ├── apiKeyModel.js        # API keys created in the dashboard (hashed + encrypted)
│   │   └── messageModel.js
│   ├── routes
│   │   ├── apiKeyRoutes.js       # /api/keys (admin only)
│   │   └── messageRoutes.js      # /api/messages
│   ├── utils
│   │   ├── apiKeys.js            # Key generation, hashing, encryption
│   │   ├── logger.js
│   │   ├── mask.js
│   │   ├── otp.js                # Detects the one-time code in a message
│   │   ├── session.js            # Signed session cookies
│   │   └── time.js
│   └── views                     # Web interface (served as static files)
│       ├── favicon.svg
│       ├── formatters.js         # Detects and renders JSON / HTML / XML / syslog / text messages
│       ├── index.html            # Dashboard: Messages, Send test, API keys, API reference
│       ├── login.html
│       ├── login.js
│       ├── scripts.js
│       ├── styles.css
│       └── theme.js              # System / light / dark theme, applied before first paint
├── test                          # node:test suites (npm test)
├── .github/workflows/docker.yml  # Tests, then builds and publishes the image to ghcr.io
├── Dockerfile
├── docker-entrypoint.sh          # Checks mounted folders are writable before starting
├── docker-compose.yml
├── package.json
├── .env                          # Your local config (not committed)
├── sample.env
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) 22.13 or later (tested with Node.js 22 and 24) and npm. SQLite support is built into Node, so there are no native modules to compile and the same install works on Windows, WSL, Linux, and macOS.
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

2. Open `http://localhost:30001` in your browser (or whichever `PORT` you set) and sign in with `ADMIN_USERNAME` (default `admin`) and `ADMIN_PASSWORD`.

3. Open **Send test** in the sidebar to store a test message, or send messages from your own application through the API with an `X-API-Key` header (**API reference** has ready-to-copy examples for this server). Messages appear under **Messages**, newest first.

To run the tests:
```
npm test
```

## Authentication

| Who | How | Can do |
|-----|-----|--------|
| Applications sending SMS | `X-API-Key: <key>` with a **Send** key | `POST /api/messages` only |
| E2E tests reading OTPs | `Authorization: Bearer <key>` (or `X-API-Key`) with a **Read** key | `GET /api/messages`, `GET /api/messages/latest` |
| Scripts needing full access | `Authorization: Bearer <ADMIN_TOKEN>` from `.env` | Everything |
| People using the dashboard | Sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` (sets an HttpOnly session cookie) | Everything |

### API keys

Create and manage keys on the dashboard's **API keys** page. You don't need to edit `.env` or restart the server.

- **New key:** give it a name (for example the app that will use it) and a type. **Send** keys post messages; **Read** keys list messages and fetch the latest one, for tests that read OTPs. The page shows the key with a **Copy** button and a ready-to-run `curl` example.
- **Show / Copy:** any active key can be shown or copied again later from the list.
- **Usage:** the list shows how many messages each key sent and when it was last used. Every message records the name of the key that sent it, returned as `apiKeyName`. Messages from the dashboard's test form are recorded as `dashboard`.
- **Revoke:** anything using a revoked key gets `401` immediately. Revoked keys stay in the list, struck through, so their messages keep a known name.
- **Key format:** `sms_send_…` or `sms_read_…`, so a key's type is visible in the key itself.

How keys are protected:
- **Storage:** the database stores a SHA-256 hash of each key, used to check requests, and an AES-256-GCM encrypted copy, used only to show it in the dashboard. The encryption key is derived from `SESSION_SECRET`.
- **If `SESSION_SECRET` changes:** existing keys keep working, but they can no longer be shown or copied. Create new ones if you need to copy them.
- **Who can see keys:** only an admin (dashboard session or `ADMIN_TOKEN`) can list, show, create or revoke keys. API keys can't manage keys. Showing a key is logged with its name and the caller's IP, and these responses are never cached.

Keys in `INGEST_API_KEYS` (`.env`, `name:key` pairs) still work as Send keys. They're listed on the page marked `.env` and can be copied there; to revoke one, remove it from `.env` and restart.

To turn off authentication completely for local development, set `AUTH_DISABLED=true`. Don't do this on a server other people can reach.

## Running with Docker

The image is published to GitHub Container Registry as `ghcr.io/sunnykatiyar50/sms-test-service`. It runs as the unprivileged `node` user (UID 1000), for `linux/amd64` and `linux/arm64`.

### With Docker Compose

Requires Docker with the Compose plugin.

1. Copy `sample.env` to `.env` and fill in at least `ADMIN_PASSWORD` and `SESSION_SECRET`. After starting, create API keys on the dashboard's **API keys** page. Compose reads **all** settings from this file.
2. Start it:
   ```
   docker compose up -d
   ```
3. To update to the latest image later:
   ```
   docker compose pull && docker compose up -d
   ```

The service is available at `http://localhost:30001` (or the `PORT` in `.env`; the same port is used on the host and in the container). Messages and logs are kept in the `sms-data` and `sms-logs` volumes. To delete them, run `docker compose down -v`.

Keep `SQLITE_PATH` and `LOG_DIR` unset in `.env` when using Docker. The image already points them at `/app/data` and `/app/logs`, which are the mounted folders.

**Bind mounts instead of volumes.** To keep the files in host folders, replace the `volumes:` entries with bind mounts such as `./data:/app/data` and `./logs:/app/logs`. The folders must be writable by UID 1000. Create them yourself before the first start, so Docker doesn't create them as root:
```
sudo mkdir -p ./data ./logs && sudo chown -R 1000:1000 ./data ./logs
```
If a folder isn't writable, the container explains this at startup and prints the command to fix it. For the log folder it continues with stdout logging only. Alternatively, run the container once as root (`user: root` in Compose); it then fixes the ownership itself and still runs the app as UID 1000.

**PostgreSQL or MySQL.** Use the bundled PostgreSQL container (`docker compose --profile postgres up -d`) or any external server. Both are configured with the same `PG_*` (or `MYSQL_*`) variables in `.env`; see [Database setup](#database-setup).

**Listening on one interface only.** Put an address in front of the port in `docker-compose.yml`, for example `"100.110.180.13:30001:30001"` for a VPN or Tailscale address.

### With `docker run`

```
docker run -d --name sms-test-service --init --restart unless-stopped \
  --env-file .env -p 30001:30001 \
  -v sms-data:/app/data -v sms-logs:/app/logs \
  ghcr.io/sunnykatiyar50/sms-test-service:latest
```
The container port must match `PORT` in `.env` (30001 by default).

Stopping the container (`docker compose down` or `docker stop`) shuts the app down cleanly: it finishes in-flight requests and closes the database.

If you put the service behind a reverse proxy (nginx, Traefik, Nginx Proxy Manager, etc.), set `TRUST_PROXY=1` so rate limiting sees real client IPs and session cookies are marked `Secure` over HTTPS.

### Publishing the image

A GitHub Actions workflow (`.github/workflows/docker.yml`) runs the tests on Node 22 and 24, then builds and publishes the image:

| Event | Tags |
|-------|------|
| Push to `main` | `latest`, `sha-<commit>` |
| Push a tag such as `v2.1.0` | `2.1.0`, `2.1`, `2`, `sha-<commit>` |
| Pull request | Builds the image to check it, but doesn't publish |

To publish a versioned release:
```
git tag v2.0.0
git push origin v2.0.0
```

New packages on GitHub Container Registry are private. To let anyone pull without logging in, open the package on GitHub (your profile → **Packages** → `sms-test-service` → **Package settings**) and change its visibility to **Public**. To pull a private image, first run `docker login ghcr.io` with a personal access token that has the `read:packages` scope.

### Building the image yourself

```
docker build -t sms-test-service .
```
To run your own build with Compose, change `image:` in `docker-compose.yml` to `sms-test-service`.

## API Endpoints

Errors are returned as JSON: `{ "error": "..." }`. Validation errors also include a `details` object keyed by field.

### `POST /api/messages`

Store a new message. The server adds the timestamp. Requires a **Send** key in `X-API-Key`.

Request body (JSON):

| Field     | Type   | Description |
|-----------|--------|-------------|
| `sender`  | string | Optional. Sender name or number, at most 64 characters |
| `phone`   | string | Required. Recipient phone number: 6–15 digits with an optional leading `+`. Spaces, dashes, dots, and brackets are removed. |
| `message` | string | Required. Message text, at most 1600 characters |

```
curl -X POST http://localhost:30001/api/messages \
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

List messages, newest first, with optional filtering and pagination. Requires a **Read** key (`Authorization: Bearer <key>` or `X-API-Key`) or admin authentication.

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
curl -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:30001/api/messages?search=OTP&page=1&pageSize=20"
```

Response `200`:
```json
{
  "messages": [
    { "id": 1, "sender": "MyApp", "phone": "*******4567", "message": "Your OTP is 123456", "timestamp": "2026-01-01T10:00:00.000Z", "apiKeyName": "myapp", "code": "123456" }
  ],
  "totalPages": 1,
  "totalMessages": 1,
  "currentPage": 1
}
```

Every message in API responses includes `code`: the one-time code detected in the text, or `null`. Detection handles:
- plain codes of 4–8 digits, with the keyword before or after them ("123456 is your code");
- split codes like `123-456` or `123 456` (returned as `123456`), Google-style `G-123456`, and letter codes like `AB12CD`;
- keywords in several languages (OTP, code, passcode, PIN, código, код, ओटीपी, 验证码, …).

Amounts (`Rs 5,000`), order, transaction and reference numbers, dates, times, and phone numbers are ignored.

### `GET /api/messages/latest`

Return the newest message that matches the same filters as `GET /api/messages` (usually `phone`), or `404` if there is none. Requires a **Read** key or admin authentication. This is handy in E2E tests to read the OTP your application just sent:

```
curl -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:30001/api/messages/latest?phone=15551234567"
```

```js
// Playwright / Cypress / Jest example
const res = await fetch(`${SMS_URL}/api/messages/latest?phone=15551234567`, {
  headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
});
const { code } = await res.json(); // e.g. "123456"
```

### `DELETE /api/messages/:id`

Delete a message by its ID. Requires admin authentication.

```
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:30001/api/messages/1
```

Returns `200` if the message was deleted, or `404` if no message has that ID.

### `DELETE /api/messages`

Delete several messages at once (up to 500). Requires admin authentication.

```
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"ids": [1, 2, 3]}' http://localhost:30001/api/messages
```

Response `200`: `{ "message": "Messages deleted successfully.", "deleted": 3 }`

### API key management

Admin only (dashboard session or `ADMIN_TOKEN`); API keys themselves can't use these endpoints. Responses are sent with `Cache-Control: no-store`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/keys` | List keys (never including their values), `.env` keys, and whether `ADMIN_TOKEN` is set |
| `POST` | `/api/keys` | Create a key: `{ "name": "checkout-app", "scope": "send" }` (`send` or `read`). Returns `{ key, secret }` |
| `POST` | `/api/keys/:id/reveal` | Returns `{ secret }` for an active key. `409` if it can't be decrypted because `SESSION_SECRET` changed |
| `POST` | `/api/keys/env/:name/reveal` | Returns `{ secret }` for an `INGEST_API_KEYS` entry |
| `DELETE` | `/api/keys/:id` | Revoke a key |

### `GET /health`

Public. Returns `{ "status": "ok" }` when the database is reachable, `503` otherwise. Used by the Docker health check.

## Environment Configuration

See `sample.env` for a commented template.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `30001` | Port the server listens on |
| `INGEST_API_KEYS` | — | Optional. Send keys as comma-separated `name:key` pairs (16+ characters each), in addition to keys created on the dashboard's API keys page |
| `ADMIN_USERNAME` | `admin` | Dashboard username. Changing it signs out existing sessions. |
| `ADMIN_PASSWORD` | — | Required. Dashboard password |
| `SESSION_SECRET` | — | Required. At least 32 characters; signs session cookies |
| `ADMIN_TOKEN` | — | Optional bearer token for scripts and tests (at least 16 characters) |
| `SESSION_TTL_HOURS` | `12` | How long a dashboard sign-in lasts |
| `AUTH_DISABLED` | `false` | `true` turns off all authentication (local development only) |
| `TRUST_PROXY` | — | Number of reverse-proxy hops in front of the service (e.g. `1`) |
| `INGEST_RATE_LIMIT` | `120` | Max `POST /api/messages` requests per minute per client IP |
| `RETENTION_DAYS` | `0` | Delete messages older than this many days, checked hourly (`0` keeps everything) |
| `LOG_DIR` | `./logs` | Directory for log files |
| `LOG_TO_FILE` | `true` | `false` logs to stdout only (handy in containers, where `docker logs` already collects output) |
| `DB_TYPE` | `sqlite` | `sqlite`, `postgres`, or `mysql` |
| `SQLITE_PATH` | `./sms-db.sqlite` | SQLite database file (the Docker image uses `/app/data/sms-db.sqlite`) |
| `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` | — | PostgreSQL connection, the same for the bundled container and external servers ([Database setup](#database-setup)) |
| `PG_SSL` | `false` | `true` (verified TLS), `no-verify` (TLS, self-signed certificates), or `false` |
| `PG_SSL_CA` | — | Path to an extra CA certificate (PEM) to trust |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | — | MySQL connection settings |
| `MYSQL_SSL`, `MYSQL_SSL_CA` | `false`, — | Same as `PG_SSL` and `PG_SSL_CA`, for MySQL |

For every database type, the `messages` table is created automatically on startup if it doesn't exist, and older tables get the new `api_key_name` column added. For PostgreSQL and MySQL, the database itself must already exist.

### Database setup

**SQLite** (default) needs no settings.

**PostgreSQL** always uses the same five variables, whether the database is the bundled container or a server somewhere else:

```
DB_TYPE=postgres
PG_HOST=…          # see the table below
PG_PORT=5432
PG_USER=sms
PG_PASSWORD=…
PG_DATABASE=sms
PG_SSL=false       # true for most hosted databases
```

Only `PG_HOST`, and for hosted databases `PG_SSL`, depend on where the database runs:

| Where PostgreSQL runs | `PG_HOST` | Notes |
|---|---|---|
| Bundled container from `docker-compose.yml` | `postgres` | Start with `docker compose --profile postgres up -d`. The container is created with the same `PG_USER`, `PG_PASSWORD`, and `PG_DATABASE`. |
| On the Docker host itself | `host.docker.internal` | The server must listen on an address the container can reach, not only `127.0.0.1`. |
| Another server, VPN address, or another Compose stack | Its hostname or IP | For another stack, put both containers on a shared Docker network and use the database's service name. |
| Hosted (Neon, Supabase, AWS RDS, Azure, …) | The host from the provider's connection string | Set `PG_SSL=true`. |
| App running without Docker | `localhost` (or the server's address) | — |

Inside Docker, never use `localhost`: it means the app's own container, so the connection fails with `ECONNREFUSED 127.0.0.1:5432`.

`PG_SSL` controls TLS:
- `false` (default): no TLS, for local servers and Docker networks.
- `true`: TLS, with the server certificate verified against the system's trusted CAs.
- `no-verify`: TLS without verifying the certificate, for servers with a self-signed certificate.

If the server's certificate comes from a CA that isn't in the system store (for example the AWS RDS bundle), mount the PEM file into the container and set `PG_SSL_CA` to its path.

If your provider gives a connection string such as `postgres://user:pass@host:5432/db?sslmode=require`, split it into these variables: `user` → `PG_USER`, `pass` → `PG_PASSWORD`, `host` → `PG_HOST`, `5432` → `PG_PORT`, `db` → `PG_DATABASE`, and `sslmode=require` → `PG_SSL=true`.

**MySQL** works the same way with `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_SSL`, and `MYSQL_SSL_CA`, using the same rules for the host. There is no bundled MySQL container.

## Upgrading from 1.x

- Authentication is now required. Add `INGEST_API_KEYS`, `ADMIN_USERNAME` (optional, defaults to `admin`), `ADMIN_PASSWORD`, and `SESSION_SECRET` to `.env`, and send `X-API-Key` from your applications. Use `AUTH_DISABLED=true` if you need the old open behaviour on a local machine.
- `GET /api/messages` returns masked phone numbers unless you pass `unmask=true`.
- The unused `DATABASE_URL` setting has been removed.

## Troubleshooting

- **The server exits with `Invalid auth configuration`:** one of the required auth settings is missing, too short, or still a `change-me` placeholder. The message lists what to fix.
- **The server exits with `Startup failed`:** usually the database connection. Check `DB_TYPE` and the connection settings in `.env`, and make sure the database server is running and reachable. To rule out the database server, set `DB_TYPE=sqlite`.
- **`401 Invalid or revoked API key`:** the key doesn't match an active key on the API keys page or in `INGEST_API_KEYS`. After changing `.env`, restart the server.
- **`403 This is a Read key…` / `This is a Send key…`:** the key's type doesn't allow that request. Sending needs a Send key, and reading needs a Read key.
- **Every client shares one rate limit behind a proxy:** set `TRUST_PROXY=1`.
- **`EACCES: permission denied` for `/app/logs/app.log` or `unable to open database file` in Docker:** the mounted folder isn't writable by UID 1000, which the container runs as. This usually happens when Docker created a bind-mount folder as root. Fix it once on the host with `sudo chown -R 1000:1000 <folder>`, or start the container once with `user: root` (Compose) / `--user root` to have it fixed automatically. The container's startup output names the folder and the command. If only the log folder is affected, the app keeps running and logs to stdout.
- **`ECONNREFUSED 127.0.0.1:5432` (or `:3306`) in Docker:** `PG_HOST` / `MYSQL_HOST` is `localhost`, which inside a container means the container itself. Use the database container's service name (`postgres` with the bundled profile), or `host.docker.internal` for a database on the host machine.
- **`no pg_hba.conf entry … no encryption`, `SSL/TLS required`, or `connection is insecure` from a hosted database:** the server requires TLS. Set `PG_SSL=true` (or `MYSQL_SSL=true`).
- **`self-signed certificate in certificate chain` or `unable to verify the first certificate`:** TLS is on, but the server's certificate isn't trusted. Set `PG_SSL_CA` to the provider's CA file, or use `PG_SSL=no-verify` for a server with a self-signed certificate.
- **`invalid ELF header` or `not a valid Win32 application` mentioning `node_sqlite3.node`:** a `node_modules` folder from an older version still contains the native `sqlite3` module, built for another OS (for example installed on Windows and started from WSL). Current versions don't use it. Delete `node_modules` and run `npm install` again.
- **`SQLite is an experimental feature` warning on Node 22:** harmless. The npm scripts already hide it; it only appears if you start the app with plain `node src/app.js`.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for any suggestions or improvements.

## License

This project is licensed under the MIT License.
