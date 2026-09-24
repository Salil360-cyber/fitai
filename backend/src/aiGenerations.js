const crypto = require('crypto');
const { pool } = require('./db');

async function recordGeneration({ userId, input, output, status }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await pool.query(
    'INSERT INTO ai_generations (id, user_id, input_json, output_json, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, userId, JSON.stringify(input), output ? JSON.stringify(output) : null, status, createdAt]
  );
  return getOwnedGeneration(id, userId);
}

async function getOwnedGeneration(id, userId) {
  const { rows } = await pool.query('SELECT * FROM ai_generations WHERE id = $1', [id]);
  const row = rows[0];
  if (!row || row.user_id !== userId) return null; // never reveal existence to a non-owner
  return {
    id: row.id,
    status: row.status,
    input: JSON.parse(row.input_json),
    output: row.output_json ? JSON.parse(row.output_json) : null,
    created_at: row.created_at
  };
}

async function listGenerations(userId, limit) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const { rows } = await pool.query(
    'SELECT id, status, created_at FROM ai_generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, safeLimit]
  );
  return rows;
}

module.exports = { recordGeneration, getOwnedGeneration, listGenerations };
