const crypto = require('crypto');
const { pool } = require('./db');
const catalog = require('./catalog');
const aiGenerations = require('./aiGenerations');

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;
const POSTGRES_UNIQUE_VIOLATION = '23505';

async function createCatalogSession(userId, workoutId) {
  const workout = await catalog.getWorkoutById(workoutId);
  if (!workout) return { error: 'workout not found' };

  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await pool.query(
    'INSERT INTO workout_sessions (id, user_id, workout_id, source, name, status, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, userId, workoutId, 'catalog', workout.title, 'in_progress', startedAt]
  );

  return { session: await getSessionRow(id) };
}

// An AI session must reference a real, owned, successfully-validated
// ai_generations record — never an arbitrary client-supplied exercise
// list. This is what lets resolveExerciseName() below trust an AI
// session's exercise names the same way it trusts a catalog session's.
async function createAiSessionFromGeneration(userId, aiGenerationId) {
  const generation = await aiGenerations.getOwnedGeneration(aiGenerationId, userId);
  if (!generation) return { error: 'generation not found' };
  if (generation.status !== 'generated' || !generation.output) {
    return { error: 'generation was not successful' };
  }

  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await pool.query(
    'INSERT INTO workout_sessions (id, user_id, workout_id, source, name, status, started_at, ai_generation_id) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)',
    [id, userId, 'ai', generation.output.name, 'in_progress', startedAt, aiGenerationId]
  );

  return { session: await getSessionRow(id) };
}

async function getSessionRow(id) {
  const { rows } = await pool.query('SELECT * FROM workout_sessions WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getOwnedSession(id, userId) {
  const row = await getSessionRow(id);
  if (!row || row.user_id !== userId) return null; // never reveal existence to a non-owner
  return row;
}

async function getCurrentSession(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM workout_sessions WHERE user_id = $1 AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1",
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...row, sets: await getSetsForSession(row.id) };
}

async function getSetsForSession(sessionId) {
  const { rows } = await pool.query(
    'SELECT exercise_name, exercise_index, set_index, reps, weight FROM workout_sets WHERE session_id = $1 ORDER BY exercise_index ASC, set_index ASC',
    [sessionId]
  );
  return rows;
}

async function resolveExerciseName(session, exerciseIndex, clientName) {
  if (session.source === 'catalog' && session.workout_id) {
    const workout = await catalog.getWorkoutById(session.workout_id);
    if (workout && workout.exercises[exerciseIndex]) {
      return workout.exercises[exerciseIndex].name;
    }
  }
  if (session.source === 'ai' && session.ai_generation_id) {
    const generation = await aiGenerations.getOwnedGeneration(session.ai_generation_id, session.user_id);
    if (generation && generation.output && generation.output.exercises[exerciseIndex]) {
      return generation.output.exercises[exerciseIndex].name;
    }
  }
  // No generation/catalog reference to resolve against — fall back to
  // client-supplied text, trimmed.
  return typeof clientName === 'string' ? clientName.trim() : null;
}

async function logSet(session, { exercise_index, set_index, reps, weight, exercise_name }) {
  const { rows: existingRows } = await pool.query(
    'SELECT * FROM workout_sets WHERE session_id = $1 AND exercise_index = $2 AND set_index = $3',
    [session.id, exercise_index, set_index]
  );
  if (existingRows[0]) {
    // Duplicate submission (retry/double-click) — return what's already
    // recorded instead of erroring or inserting a second row.
    return { set: existingRows[0], duplicate: true };
  }

  const resolvedName = await resolveExerciseName(session, exercise_index, exercise_name);
  if (!resolvedName) return { error: 'could not resolve exercise name' };

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await pool.query(
      'INSERT INTO workout_sets (id, session_id, exercise_name, exercise_index, set_index, reps, weight, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, session.id, resolvedName, exercise_index, set_index, reps, weight, createdAt]
    );
  } catch (e) {
    if (e.code === POSTGRES_UNIQUE_VIOLATION) {
      // Race: two near-simultaneous requests both passed the check
      // above. The UNIQUE constraint caught it — return the row that won.
      const { rows: winnerRows } = await pool.query(
        'SELECT * FROM workout_sets WHERE session_id = $1 AND exercise_index = $2 AND set_index = $3',
        [session.id, exercise_index, set_index]
      );
      return { set: winnerRows[0], duplicate: true };
    }
    throw e;
  }
  const { rows: savedRows } = await pool.query('SELECT * FROM workout_sets WHERE id = $1', [id]);
  return { set: savedRows[0], duplicate: false };
}

async function completeSession(session) {
  const completedAt = new Date();
  const startedAt = new Date(session.started_at);
  const durationMin = Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 60000));

  await pool.query(
    "UPDATE workout_sessions SET status = 'completed', completed_at = $1, duration_min = $2 WHERE id = $3",
    [completedAt.toISOString(), durationMin, session.id]
  );

  const sets = await getSetsForSession(session.id);
  const exercisesCompleted = new Set(sets.map((s) => s.exercise_index)).size;

  return {
    session: {
      id: session.id,
      workout_id: session.workout_id,
      name: session.name,
      status: 'completed',
      started_at: session.started_at,
      completed_at: completedAt.toISOString(),
      duration_min: durationMin,
      exercises_completed: exercisesCompleted,
      sets_completed: sets.length
    }
  };
}

async function listSessions(userId, { status, limit } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  let rows;
  if (status) {
    ({ rows } = await pool.query(
      'SELECT * FROM workout_sessions WHERE user_id = $1 AND status = $2 ORDER BY COALESCE(completed_at, started_at) DESC LIMIT $3',
      [userId, status, safeLimit]
    ));
  } else {
    ({ rows } = await pool.query(
      'SELECT * FROM workout_sessions WHERE user_id = $1 ORDER BY COALESCE(completed_at, started_at) DESC LIMIT $2',
      [userId, safeLimit]
    ));
  }
  return rows.map((r) => ({
    id: r.id,
    workout_id: r.workout_id,
    source: r.source,
    name: r.name,
    status: r.status,
    started_at: r.started_at,
    completed_at: r.completed_at,
    duration_min: r.duration_min
  }));
}

/*
 * Progress definitions (mirrors the original store.js#computeProgress()
 * logic exactly, computed server-side from real rows):
 *  - workouts_this_week: completed sessions whose completed_at falls
 *    within the last 7*24h (a rolling window ending "now" in UTC — NOT
 *    a Mon-Sun calendar week).
 *  - streak: consecutive calendar days (UTC date, i.e. the date portion
 *    of completed_at) that have at least one completed session, counted
 *    backward starting from today. A day with zero completed sessions
 *    breaks the streak.
 *  - completed_sets: total row count in workout_sets across all of the
 *    user's completed sessions.
 */
async function getProgress(userId) {
  const { rows: completed } = await pool.query(
    "SELECT * FROM workout_sessions WHERE user_id = $1 AND status = 'completed'",
    [userId]
  );

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const workoutsThisWeek = completed.filter((s) => now - new Date(s.completed_at).getTime() <= weekMs).length;

  const dayKeys = {};
  completed.forEach((s) => {
    dayKeys[new Date(s.completed_at).toISOString().slice(0, 10)] = true;
  });
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!dayKeys[key]) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let completedSets = 0;
  if (completed.length > 0) {
    const placeholders = completed.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM workout_sets WHERE session_id IN (${placeholders})`,
      completed.map((s) => s.id)
    );
    completedSets = rows[0].c;
  }

  return { workouts_this_week: workoutsThisWeek, streak, completed_sets: completedSets };
}

module.exports = {
  createCatalogSession,
  createAiSessionFromGeneration,
  getSessionRow,
  getOwnedSession,
  getCurrentSession,
  logSet,
  completeSession,
  listSessions,
  getProgress
};
