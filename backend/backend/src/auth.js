const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('./db');

const SALT_ROUNDS = 12;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function createUser({ id, email, passwordHash }, client) {
  const createdAt = new Date().toISOString();
  await (client || pool).query(
    'INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)',
    [id, email, passwordHash, createdAt]
  );
}

async function createProfile({ userId, name }, client) {
  await (client || pool).query(
    'INSERT INTO profiles (user_id, name, preferences) VALUES ($1, $2, $3)',
    [userId, name, '[]']
  );
}

async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await pool.query(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [token, userId, createdAt, expiresAt]
  );
  return { token, expiresAt };
}

async function getSessionUser(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
  const session = rows[0];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    return null;
  }
  return findUserById(session.user_id);
}

async function destroySession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

function safeUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, created_at: user.created_at };
}

module.exports = {
  isValidEmail,
  isValidPassword,
  hashPassword,
  verifyPassword,
  createUser,
  createProfile,
  findUserByEmail,
  findUserById,
  createSession,
  getSessionUser,
  destroySession,
  safeUser
};
