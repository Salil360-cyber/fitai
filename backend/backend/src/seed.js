/*
 * Seed data — copied from the actual existing frontend hardcoded
 * sources, not invented: the 6 workout cards from
 * WorkoutDiscovery.dc.html (name, duration, difficulty, category,
 * recommended flag) and the exact 3 exercises from WorkoutDetails.dc.html
 * for "Upper Body Strength". Exercise lists for the other 5 workouts
 * were never defined anywhere in the frontend — those are ordinary
 * catalog/seed content, not user research.
 */

const WORKOUTS = [
  {
    id: 'upper-body-strength',
    title: 'Upper Body Strength',
    duration_min: 32,
    difficulty: 'Intermediate',
    category: 'Strength',
    is_recommended: true,
    exercises: [
      { name: 'Bench Press', sets: 3, reps: 10, weight: 60 },
      { name: 'Dumbbell Row', sets: 3, reps: 12, weight: 20 },
      { name: 'Overhead Press', sets: 3, reps: 8, weight: 35 }
    ]
  },
  {
    id: 'full-body-hiit',
    title: 'Full Body HIIT',
    duration_min: 20,
    difficulty: 'Beginner',
    category: 'Full Body',
    is_recommended: true,
    exercises: [
      { name: 'Jumping Jacks', sets: 3, reps: 30, weight: null },
      { name: 'Bodyweight Squat', sets: 3, reps: 15, weight: null },
      { name: 'Push-Up', sets: 3, reps: 10, weight: null },
      { name: 'Mountain Climbers', sets: 3, reps: 20, weight: null }
    ]
  },
  {
    id: '5k-cardio-blast',
    title: '5K Cardio Blast',
    duration_min: 28,
    difficulty: 'Intermediate',
    category: 'Cardio',
    is_recommended: false,
    exercises: [
      { name: 'Jumping Jacks', sets: 4, reps: 30, weight: null },
      { name: 'Mountain Climbers', sets: 4, reps: 25, weight: null },
      { name: 'Kettlebell/DB Swing', sets: 3, reps: 15, weight: 16 }
    ]
  },
  {
    id: 'lower-body-power',
    title: 'Lower Body Power',
    duration_min: 35,
    difficulty: 'Advanced',
    category: 'Strength',
    is_recommended: false,
    exercises: [
      { name: 'Goblet Squat', sets: 4, reps: 8, weight: 40 },
      { name: 'Kettlebell/DB Swing', sets: 3, reps: 15, weight: 24 },
      { name: 'Bodyweight Squat', sets: 3, reps: 20, weight: null }
    ]
  },
  {
    id: 'morning-mobility-flow',
    title: 'Morning Mobility Flow',
    duration_min: 15,
    difficulty: 'Beginner',
    category: 'Mobility',
    is_recommended: true,
    exercises: [
      { name: 'Plank', sets: 3, reps: 30, weight: null },
      { name: 'Bodyweight Squat', sets: 2, reps: 15, weight: null },
      { name: 'Push-Up', sets: 2, reps: 10, weight: null }
    ]
  },
  {
    id: 'full-body-circuit',
    title: 'Full Body Circuit',
    duration_min: 40,
    difficulty: 'Intermediate',
    category: 'Full Body',
    is_recommended: false,
    exercises: [
      { name: 'Push-Up', sets: 3, reps: 15, weight: null },
      { name: 'Bodyweight Squat', sets: 3, reps: 20, weight: null },
      { name: 'Mountain Climbers', sets: 3, reps: 20, weight: null },
      { name: 'Jumping Jacks', sets: 3, reps: 30, weight: null }
    ]
  }
];

async function seedIfEmpty(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM workouts');
  if (rows[0].count > 0) {
    return { seeded: false, count: rows[0].count };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const w of WORKOUTS) {
      await client.query(
        'INSERT INTO workouts (id, title, duration_min, difficulty, category, image_url, is_recommended) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [w.id, w.title, w.duration_min, w.difficulty, w.category, null, w.is_recommended]
      );
      for (let i = 0; i < w.exercises.length; i++) {
        const ex = w.exercises[i];
        await client.query(
          'INSERT INTO workout_exercises (id, workout_id, name, sets, reps, weight, order_index) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [`${w.id}-ex${i}`, w.id, ex.name, ex.sets, ex.reps, ex.weight, i]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { seeded: true, count: WORKOUTS.length };
}

module.exports = { seedIfEmpty, WORKOUTS };
