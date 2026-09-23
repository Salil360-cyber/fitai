-- FitAI — Database Schema (PostgreSQL)
-- Auth, profile, workout catalog, workout sessions/sets, and AI generations.
--
-- Timestamp columns are TEXT storing app-generated ISO-8601 strings
-- (new Date().toISOString()) rather than TIMESTAMPTZ with a SQL-level
-- default. This is a deliberate choice, not an oversight: the API has
-- always returned these fields as plain ISO strings (e.g. in
-- POST /auth/register's response), and node-postgres would otherwise
-- auto-parse a TIMESTAMPTZ column into a JS Date object on read,
-- silently changing every response shape that includes one. Keeping
-- them TEXT preserves the existing API contract exactly.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fitness_goal TEXT,
  fitness_level TEXT,
  preferences TEXT NOT NULL DEFAULT '[]'   -- JSON array, e.g. ["strength","cardio"]
);

-- Opaque server-side session tokens (not JWTs).
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Workout Catalog. is_recommended is a boolean flag the existing
-- Workout Discovery UI's "Recommended" filter chip relies on — it cuts
-- across categories, so it can't be derived from `category` alone.
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  is_recommended BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_workouts_category ON workouts(category);
CREATE INDEX IF NOT EXISTS idx_workouts_is_recommended ON workouts(is_recommended);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sets INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight INTEGER,
  order_index INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout_id ON workout_exercises(workout_id);

-- ai_generations must exist before workout_sessions references it below.
CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('generated', 'failed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_generations_user_id ON ai_generations(user_id);

-- Workout Sessions + Set Logging + Progress.
-- ai_generation_id is declared directly here (rather than via a
-- separate migration-only ALTER TABLE, as the SQLite version needed for
-- an already-existing table): Neon/Postgres starts from an empty
-- database, so there is no pre-existing workout_sessions table to
-- migrate around — a clean CREATE TABLE is simpler and equally safe.
CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT REFERENCES workouts(id),
  source TEXT NOT NULL CHECK (source IN ('catalog', 'ai')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')) DEFAULT 'in_progress',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_min INTEGER,
  ai_generation_id TEXT REFERENCES ai_generations(id)
);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_status ON workout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_workout_id ON workout_sessions(workout_id);

CREATE TABLE IF NOT EXISTS workout_sets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  exercise_index INTEGER NOT NULL,
  set_index INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  weight INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  -- Duplicate-submission protection (retries/double-clicks): the same
  -- exercise+set within a session can only be recorded once.
  UNIQUE (session_id, exercise_index, set_index)
);
CREATE INDEX IF NOT EXISTS idx_workout_sets_session_id ON workout_sets(session_id);
