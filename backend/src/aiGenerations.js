const crypto = require('crypto');
const db = require('./db');

function recordGeneration({ userId, input, output, status }) {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO ai_generations (id, user_id, input_json, output_json, status) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, JSON.stringify(input), output ? JSON.stringify(output) : null, status);
  return getOwnedGeneration(id, userId);
}

function getOwnedGeneration(id, userId) {
  const row = db.prepare('SELECT * FROM ai_generations WHERE id = ?').get(id);
  if (!row || row.user_id !== userId) return null; // never reveal existence to a non-owner
  return {
    id: row.id,
    status: row.status,
    input: JSON.parse(row.input_json),
    output: row.output_json ? JSON.parse(row.output_json) : null,
    created_at: row.created_at
  };
}

function listGenerations(userId, limit) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const rows = db.prepare(
    'SELECT id, status, created_at FROM ai_generations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, safeLimit);
  return rows;
}

module.exports = { recordGeneration, getOwnedGeneration, listGenerations };
