# SMS Test Service

This project is an SMS Gateway application that allows users to send and log messages using a simple web interface. The application is built with Node.js and uses SQLite as the database to store messages.

## Project Structure
```
sms-test-service
├── src
│   ├── app.js
│   ├── controllers
│   │   └── messageController.js
│   ├── database
│   │   ├── initDatabase.js
│   │   ├── mysql.js
│   │   ├── postgres.js
│   │   └── sqlite.js
│   ├── models
│   │   └── messageModel.js
│   ├── routes
│   │   └── messageRoutes.js
│   ├── utils
│   │   └── logger.js
│   └── views
│       ├── index.html
│       ├── scripts.js
│       └── styles.css
├── logs/
│   └── ... (log files)
├── sms-db.sqlite
├── package.json
├── package-lock.json
├── LICENSE
├── .env
├── sample.env
└── README.md
```

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```
   cd sms-test-service
   ```

3. Install the dependencies:
   ```
   npm install
   ```

4. Create a `.env` file in the root directory and configure your environment variables as needed.

## Usage
1. Start the application:
   ```
   npm start
   ```
2. Open your web browser and navigate to `http://localhost:3000` to access the SMS Gateway interface.

3. Use the form to send messages. Sent messages will be logged and displayed in the list below the form.

## API Endpoints

- `POST /api/messages`: Send a new message.
- `GET /api/messages`: Retrieve all logged messages.

## Environment Configuration

The application uses environment variables for configuration. You can copy `sample.env` to `.env` and adjust the values as needed. Below is an explanation of each variable:

```
# Port Configuration
PORT=3006                # The port your server will run on (default: 3006)

# Database Type
DB_TYPE=sqlite           # Database type: sqlite, postgres, or mysql

# SQLite Configuration
DATABASE_URL=sqlite:./database/messages.db   # SQLite database file path

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

- **PORT**: The port number the server will listen on.
- **DB_TYPE**: The type of database to use. Supported values: `sqlite`, `postgres`, `mysql`.
- **DATABASE_URL**: Path to the SQLite database file (used if `DB_TYPE=sqlite`).
- **PG_***: PostgreSQL connection settings (used if `DB_TYPE=postgres`).
- **MYSQL_***: MySQL connection settings (used if `DB_TYPE=mysql`).

> Copy `sample.env` to `.env` and edit as needed for your environment.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for any suggestions or improvements.

## License

### This project is licensed under the MIT License. ###
