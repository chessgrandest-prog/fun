const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'arcade.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        db.serialize(() => {
            // Create users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                profile_picture_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Create user_data table for syncing saves/localStorage
            db.run(`CREATE TABLE IF NOT EXISTS user_data (
                user_id INTEGER PRIMARY KEY,
                local_storage_json TEXT DEFAULT '{}',
                indexed_db_json TEXT DEFAULT '{}',
                last_synced DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )`);
        });
    }
});

module.exports = db;
