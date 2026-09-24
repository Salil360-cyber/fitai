const { pool } = require('./db');

function normalizeCategory(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, '');
}

async function listWorkouts(category) {
  const { rows } = await pool.query('SELECT * FROM workouts');
  let filtered;
  if (!category) {
    filtered = rows;
  } else if (normalizeCategory(category) === 'recommended') {
    filtered = rows.filter((w) => w.is_recommended);
  } else {
    // Normalize both sides so the frontend's existing lowercase ids
    // ("strength", "fullbody") match the stored display categories
    // ("Strength", "Full Body") without changing either one.
    filtered = rows.filter((w) => normalizeCategory(w.category) === normalizeCategory(category));
  }
  return filtered.map((w) => ({
    id: w.id,
    title: w.title,
    duration_min: w.duration_min,
    difficulty: w.difficulty,
    category: w.category,
    image_url: w.image_url,
    is_recommended: !!w.is_recommended
  }));
}

async function getWorkoutById(id) {
  const { rows } = await pool.query('SELECT * FROM workouts WHERE id = $1', [id]);
  const w = rows[0];
  if (!w) return null;
  const { rows: exercises } = await pool.query(
    'SELECT name, sets, reps, weight, order_index FROM workout_exercises WHERE workout_id = $1 ORDER BY order_index ASC',
    [id]
  );
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
