const db = require('./db');

function normalizeCategory(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, '');
}

function listWorkouts(category) {
  let rows;
  if (!category) {
    rows = db.prepare('SELECT * FROM workouts').all();
  } else if (normalizeCategory(category) === 'recommended') {
    rows = db.prepare('SELECT * FROM workouts WHERE is_recommended = 1').all();
  } else {
    // Normalize both sides so the frontend's existing lowercase ids
    // ("strength", "fullbody") match the stored display categories
    // ("Strength", "Full Body") without changing either one.
    rows = db.prepare('SELECT * FROM workouts').all()
      .filter((w) => normalizeCategory(w.category) === normalizeCategory(category));
  }
  return rows.map((w) => ({
    id: w.id,
    title: w.title,
    duration_min: w.duration_min,
    difficulty: w.difficulty,
    category: w.category,
    image_url: w.image_url,
    is_recommended: !!w.is_recommended
  }));
}

function getWorkoutById(id) {
  const w = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
  if (!w) return null;
  const exercises = db.prepare(
    'SELECT name, sets, reps, weight, order_index FROM workout_exercises WHERE workout_id = ? ORDER BY order_index ASC'
  ).all(id);
  return {
    id: w.id,
    title: w.title,
    duration_min: w.duration_min,
    difficulty: w.difficulty,
    category: w.category,
    image_url: w.image_url,
    exercises
  };
}

module.exports = { listWorkouts, getWorkoutById };
