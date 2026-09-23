const db = require('./db');

// Matches the existing onboarding vocabulary exactly (FitnessGoal.dc.html,
// FitnessLevel.dc.html, Preferences.dc.html store the human-readable
// LABELS, not ids — e.g. "Build muscle", not "build" — so validation
// here accepts that same label set rather than inventing new values).
const GOAL_LABELS = ['Lose weight', 'Build muscle', 'Improve endurance', 'General fitness'];
const LEVEL_LABELS = ['Beginner', 'Intermediate', 'Advanced'];
const PREFERENCE_LABELS = ['Strength', 'Cardio', 'Mobility', 'Full Body', 'Outdoor'];
const MAX_NAME_LEN = 80;

function rowToProfile(row, email) {
  return {
    name: row.name,
    email: email,
    fitness_goal: row.fitness_goal || null,
    fitness_level: row.fitness_level || null,
    preferences: row.preferences ? JSON.parse(row.preferences) : []
  };
}

function getProfile(userId, email) {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!row) return null;
  return rowToProfile(row, email);
}

function validateUpdate(body) {
  const updates = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.trim().length > MAX_NAME_LEN) {
      return { error: 'name must be a non-empty string' };
    }
    updates.name = body.name.trim();
  }
  if (body.fitness_goal !== undefined) {
    if (body.fitness_goal !== null && GOAL_LABELS.indexOf(body.fitness_goal) === -1) {
      return { error: 'fitness_goal must be one of ' + GOAL_LABELS.join(', ') + ', or null' };
    }
    updates.fitness_goal = body.fitness_goal;
  }
  if (body.fitness_level !== undefined) {
    if (body.fitness_level !== null && LEVEL_LABELS.indexOf(body.fitness_level) === -1) {
      return { error: 'fitness_level must be one of ' + LEVEL_LABELS.join(', ') + ', or null' };
    }
    updates.fitness_level = body.fitness_level;
  }
  if (body.preferences !== undefined) {
    if (!Array.isArray(body.preferences) || body.preferences.some((p) => PREFERENCE_LABELS.indexOf(p) === -1)) {
      return { error: 'preferences must be an array drawn from ' + PREFERENCE_LABELS.join(', ') };
    }
    updates.preferences = body.preferences;
  }
  // user_id, password_hash, session tokens, created_at are never in this
  // list — there is no code path by which a client value for them could
  // reach the database, regardless of what the request body contains.
  if (Object.keys(updates).length === 0) {
    return { error: 'no valid profile fields provided' };
  }
  return { updates };
}

function updateProfile(userId, email, body) {
  const validated = validateUpdate(body);
  if (validated.error) return { error: validated.error };

  const existing = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!existing) {
    // Defensive: every authenticated user was given a profile row at
    // registration. If one is somehow missing, create exactly one row
    // rather than silently duplicating or failing.
    db.prepare('INSERT INTO profiles (user_id, name, preferences) VALUES (?, ?, ?)').run(userId, validated.updates.name || 'FitAI User', '[]');
  }

  const fields = Object.keys(validated.updates);
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (f === 'preferences' ? JSON.stringify(validated.updates[f]) : validated.updates[f]));
  db.prepare(`UPDATE profiles SET ${sets} WHERE user_id = ?`).run(...values, userId);

  return { profile: getProfile(userId, email) };
}

module.exports = { getProfile, updateProfile, GOAL_LABELS, LEVEL_LABELS, PREFERENCE_LABELS };
