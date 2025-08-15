package main

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite", "stocksim.db")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	createTables()
	log.Println("Database initialized")
}

func createTables() {
	users := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_code TEXT UNIQUE NOT NULL,
        cash REAL DEFAULT 10000.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

	portfolio := `
    CREATE TABLE IF NOT EXISTS portfolio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        stock_id TEXT,
        shares INTEGER,
        avg_price REAL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );`

	transactions := `
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        stock_id TEXT,
        action TEXT,
        shares INTEGER,
        price REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );`

	news := `
    CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        affected_stock TEXT,
        impact REAL,
        published_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
	adminActions := `
    CREATE TABLE IF NOT EXISTS admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id TEXT,
        action TEXT,
        magnitude REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

	for _, table := range []string{users, portfolio, transactions, news, adminActions} {
		if _, err := db.Exec(table); err != nil {
			log.Fatal("Failed to create table:", err)
		}
	}
}
