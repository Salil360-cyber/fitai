-- FitAI — Database Schema
-- Auth, profile, workout catalog, workout sessions/sets, and AI generations.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                 -- uuid, generated at insert time
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fitness_goal TEXT,
  fitness_level TEXT,
  preferences TEXT NOT NULL DEFAULT '[]'   -- JSON array, e.g. ["strength","cardio"]
);

-- Opaque server-side session tokens (not JWTs) — the token itself is the
-- cookie value; nothing about the user is decodable from it client-side.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Phase 2.2 — Workout Catalog.
-- is_recommended is a small addition beyond the literal field list given
-- in the Phase 2.2 spec: the existing Workout Discovery UI has a
-- "Recommended" filter chip that cuts across categories (it is not a
-- category itself), so a boolean flag is required to preserve that
-- existing filter behavior without inventing a new catalog concept.
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  is_recommended INTEGER NOT NULL DEFAULT 0
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

-- Phase 2.3 — Workout Sessions + Set Logging + Progress.
CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT REFERENCES workouts(id),
  source TEXT NOT NULL CHECK (source IN ('catalog', 'ai')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')) DEFAULT 'in_progress',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_min INTEGER
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Duplicate-submission protection (retries/double-clicks): the same
  -- exercise+set within a session can only be recorded once.
  UNIQUE (session_id, exercise_index, set_index)
);
CREATE INDEX IF NOT EXISTS idx_workout_sets_session_id ON workout_sets(session_id);

-- Phase 2.4 — Real AI Workout Generation.
-- input_json/output_json are the exact request sent to the provider and
-- the normalized (validated) workout returned — never the provider's raw
-- prose, never secrets. workout_sessions.ai_generation_id (added via a
-- safe ALTER in db.js, since that table already exists on disk from
-- earlier phases) lets an AI-sourced session resolve its authoritative
-- exercise list the same way a catalog session resolves via workout_id.
CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('generated', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_generations_user_id ON ai_generations(user_id);
