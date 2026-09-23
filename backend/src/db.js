const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'fitai.sqlite');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Phase 2.4: workout_sessions already existed on disk from Phase 2.3, so
// CREATE TABLE IF NOT EXISTS above won't add a new column to it — do that
// safely, only if it isn't already there (idempotent across restarts).
const workoutSessionColumns = db.prepare('PRAGMA table_info(workout_sessions)').all().map((c) => c.name);
if (!workoutSessionColumns.includes('ai_generation_id')) {
  db.exec('ALTER TABLE workout_sessions ADD COLUMN ai_generation_id TEXT REFERENCES ai_generations(id)');
}

const { seedIfEmpty } = require('./seed');
seedIfEmpty(db);

module.exports = db;
