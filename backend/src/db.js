const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Neon requires SSL. Plain local Postgres (used for development/testing)
// typically doesn't have it enabled. Rather than hardcoding either
// assumption, infer it from the connection string itself.
const wantsSSL = !!connectionString && /sslmode=require/i.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: wantsSSL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  // Idle client errors (e.g. a dropped connection) must not crash the
  // whole process — log and let the pool recover on the next query.
  console.error('[fitai-backend] unexpected Postgres pool error:', err.message);
});

let initialized = false;

// Runs schema creation + the safe catalog seed. Must be awaited once at
// startup before the server accepts requests — see server.js. Not run
// automatically at require() time, since pg connections are inherently
// asynchronous and a plain `require('./db')` needs to stay synchronous.
async function initSchema() {
  if (initialized) return;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. FitAI requires a PostgreSQL connection string ' +
      '(see .env.example) — there is no SQLite fallback.'
    );
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const { seedIfEmpty } = require('./seed');
  await seedIfEmpty(pool);

  initialized = true;
}

// Runs fn(client) inside a real BEGIN/COMMIT/ROLLBACK transaction.
// Used where more than one write must succeed or fail together (e.g.
// creating a user and its profile row during registration).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, initSchema, withTransaction };
