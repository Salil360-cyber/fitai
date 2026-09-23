const crypto = require('crypto');
const db = require('./db');
const catalog = require('./catalog');
const aiGenerations = require('./aiGenerations');

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

function createCatalogSession(userId, workoutId) {
  const workout = catalog.getWorkoutById(workoutId);
  if (!workout) return { error: 'workout not found' };

  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO workout_sessions (id, user_id, workout_id, source, name, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, workoutId, 'catalog', workout.title, 'in_progress', startedAt);

  return { session: getSessionRow(id) };
}

// Phase 2.4: an AI session must reference a real, owned, successfully-
// validated ai_generations record — never an arbitrary client-supplied
// exercise list. This is what lets resolveExerciseName() below trust an
// AI session's exercise names the same way it trusts a catalog session's.
function createAiSessionFromGeneration(userId, aiGenerationId) {
  const generation = aiGenerations.getOwnedGeneration(aiGenerationId, userId);
  if (!generation) return { error: 'generation not found' };
  if (generation.status !== 'generated' || !generation.output) {
    return { error: 'generation was not successful' };
  }

  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO workout_sessions (id, user_id, workout_id, source, name, status, started_at, ai_generation_id) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)'
  ).run(id, userId, 'ai', generation.output.name, 'in_progress', startedAt, aiGenerationId);

  return { session: getSessionRow(id) };
}

function getSessionRow(id) {
  return db.prepare('SELECT * FROM workout_sessions WHERE id = ?').get(id);
}

function getOwnedSession(id, userId) {
  const row = getSessionRow(id);
  if (!row || row.user_id !== userId) return null; // never reveal existence to a non-owner
  return row;
}

function getCurrentSession(userId) {
  const row = db.prepare(
    "SELECT * FROM workout_sessions WHERE user_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1"
  ).get(userId);
  if (!row) return null;
  return { ...row, sets: getSetsForSession(row.id) };
}

function getSetsForSession(sessionId) {
  return db.prepare(
    'SELECT exercise_name, exercise_index, set_index, reps, weight FROM workout_sets WHERE session_id = ? ORDER BY exercise_index ASC, set_index ASC'
  ).all(sessionId);
}

function resolveExerciseName(session, exerciseIndex, clientName) {
  if (session.source === 'catalog' && session.workout_id) {
    const workout = catalog.getWorkoutById(session.workout_id);
    if (workout && workout.exercises[exerciseIndex]) {
      return workout.exercises[exerciseIndex].name;
    }
  }
  if (session.source === 'ai' && session.ai_generation_id) {
    const generation = aiGenerations.getOwnedGeneration(session.ai_generation_id, session.user_id);
    if (generation && generation.output && generation.output.exercises[exerciseIndex]) {
      return generation.output.exercises[exerciseIndex].name;
    }
  }
  // No generation/catalog reference to resolve against — fall back to
  // client-supplied text, trimmed.
  return typeof clientName === 'string' ? clientName.trim() : null;
}

function logSet(session, { exercise_index, set_index, reps, weight, exercise_name }) {
  const existing = db.prepare(
    'SELECT * FROM workout_sets WHERE session_id = ? AND exercise_index = ? AND set_index = ?'
  ).get(session.id, exercise_index, set_index);
  if (existing) {
    // Duplicate submission (retry/double-click) — return what's already
    // recorded instead of erroring or inserting a second row.
    return { set: existing, duplicate: true };
  }

  const resolvedName = resolveExerciseName(session, exercise_index, exercise_name);
  if (!resolvedName) return { error: 'could not resolve exercise name' };

  const id = crypto.randomUUID();
  try {
    db.prepare(
      'INSERT INTO workout_sets (id, session_id, exercise_name, exercise_index, set_index, reps, weight) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, session.id, resolvedName, exercise_index, set_index, reps, weight);
  } catch (e) {
    // Race: two near-simultaneous requests both passed the check above.
    // The UNIQUE constraint caught it — return the row that won.
    const winner = db.prepare(
      'SELECT * FROM workout_sets WHERE session_id = ? AND exercise_index = ? AND set_index = ?'
    ).get(session.id, exercise_index, set_index);
    return { set: winner, duplicate: true };
  }
  return { set: db.prepare('SELECT * FROM workout_sets WHERE id = ?').get(id), duplicate: false };
}

function completeSession(session) {
  const completedAt = new Date();
  const startedAt = new Date(session.started_at);
  const durationMin = Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 60000));

  db.prepare(
    "UPDATE workout_sessions SET status = 'completed', completed_at = ?, duration_min = ? WHERE id = ?"
  ).run(completedAt.toISOString(), durationMin, session.id);

  const sets = getSetsForSession(session.id);
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

function listSessions(userId, { status, limit } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  let rows;
  if (status) {
    rows = db.prepare(
      'SELECT * FROM workout_sessions WHERE user_id = ? AND status = ? ORDER BY COALESCE(completed_at, started_at) DESC LIMIT ?'
    ).all(userId, status, safeLimit);
  } else {
    rows = db.prepare(
      'SELECT * FROM workout_sessions WHERE user_id = ? ORDER BY COALESCE(completed_at, started_at) DESC LIMIT ?'
    ).all(userId, safeLimit);
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
 * Progress definitions (mirrors the original client-side
 * store.js#computeProgress() logic exactly, now computed server-side
 * from real rows instead of a local array):
 *  - workouts_this_week: completed sessions whose completed_at falls
 *    within the last 7*24h (a rolling window ending "now" in UTC — NOT
 *    a Mon-Sun calendar week), matching the prototype's original logic.
 *  - streak: consecutive calendar days (UTC date, i.e. the date portion
 *    of completed_at) that have at least one completed session, counted
 *    backward starting from today. A day with zero completed sessions
 *    breaks the streak.
 *  - completed_sets: total row count in workout_sets across all of the
 *    user's completed sessions.
 */
function getProgress(userId) {
  const completed = db.prepare(
    "SELECT * FROM workout_sessions WHERE user_id = ? AND status = 'completed'"
  ).all(userId);

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

  const completedSets = completed.length === 0 ? 0 : db.prepare(
    `SELECT COUNT(*) as c FROM workout_sets WHERE session_id IN (${completed.map(() => '?').join(',')})`
  ).get(...completed.map((s) => s.id)).c;

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
