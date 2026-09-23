/*
 * Phase 2.4 — never trust the raw AI response. Parses and validates it
 * against a strict schema with sane upper bounds, returning either a
 * normalized workout object or a rejection reason. Nothing here ever
 * lets an invalid/absurd AI response become a stored or returned workout.
 */

const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
const MAX_DURATION_MIN = 180;
const MAX_EXERCISES = 15;
const MAX_SETS = 20;
const MAX_REPS = 100;
const MAX_REST_SEC = 600;
const MAX_STRING_LEN = 120;

function isPosInt(v, max) {
  return Number.isInteger(v) && v > 0 && (max === undefined || v <= max);
}
function isNonNegInt(v, max) {
  return Number.isInteger(v) && v >= 0 && (max === undefined || v <= max);
}
function isCleanString(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MAX_STRING_LEN;
}

function extractJson(raw) {
  // Providers sometimes wrap JSON in prose or code fences despite
  // instructions — take the first {...} block found.
  var match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

function validateAndNormalize(raw) {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'AI response was not valid JSON' };
  }

  if (!isCleanString(parsed.name)) {
    return { ok: false, error: 'workout name missing or invalid' };
  }
  if (!isPosInt(parsed.duration_min, MAX_DURATION_MIN)) {
    return { ok: false, error: 'duration_min must be a positive integer within a reasonable range' };
  }
  if (typeof parsed.difficulty !== 'string' || DIFFICULTIES.indexOf(parsed.difficulty) === -1) {
    return { ok: false, error: 'difficulty must be one of ' + DIFFICULTIES.join('/') };
  }
  if (!isCleanString(parsed.category)) {
    return { ok: false, error: 'category missing or invalid' };
  }
  if (!Array.isArray(parsed.exercises) || parsed.exercises.length === 0) {
    return { ok: false, error: 'exercises must be a non-empty array' };
  }
  if (parsed.exercises.length > MAX_EXERCISES) {
    return { ok: false, error: 'too many exercises' };
  }

  const exercises = [];
  for (const ex of parsed.exercises) {
    if (!ex || typeof ex !== 'object' || !isCleanString(ex.name)) {
      return { ok: false, error: 'every exercise needs a valid name' };
    }
    if (!isPosInt(ex.sets, MAX_SETS)) {
      return { ok: false, error: `sets for "${ex.name}" must be a positive integer within range` };
    }
    if (!isPosInt(ex.reps, MAX_REPS)) {
      return { ok: false, error: `reps for "${ex.name}" must be a positive integer within range` };
    }
    if (!isNonNegInt(ex.rest_sec, MAX_REST_SEC)) {
      return { ok: false, error: `rest_sec for "${ex.name}" must be a non-negative integer within range` };
    }
    exercises.push({
      name: ex.name.trim(),
      sets: ex.sets,
      reps: ex.reps,
      rest_sec: ex.rest_sec
    });
  }

  return {
    ok: true,
    workout: {
      name: parsed.name.trim(),
      duration_min: parsed.duration_min,
      difficulty: parsed.difficulty,
      category: parsed.category.trim(),
      exercises
    }
  };
}

module.exports = { validateAndNormalize };
