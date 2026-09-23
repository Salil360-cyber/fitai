require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const auth = require('./auth');
const db = require('./db');
const catalog = require('./catalog');
const sessions = require('./sessions');
const aiProvider = require('./aiProvider');
const aiValidate = require('./aiValidate');
const aiGenerations = require('./aiGenerations');
const profile = require('./profile');

const app = express();
app.use(express.json());

// Clean JSON response for malformed request bodies, instead of Express's
// default HTML error page (which can include stack traces).
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  next(err);
});

app.use(cookieParser());

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
if (ALLOWED_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

const COOKIE_NAME = 'fitai_session';

// COOKIE_SAMESITE controls cross-site cookie delivery, set via env rather
// than hardcoded, so the same codebase supports both:
//  - same-origin / localhost development -> COOKIE_SAMESITE unset -> "lax"
//  - the real FitAI deployment shape, where the published artifact and
//    this API are on different origins -> COOKIE_SAMESITE=none
// Browsers reject SameSite=None cookies that aren't also Secure, so
// selecting "none" forces the Secure flag on regardless of COOKIE_SECURE.
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || COOKIE_SAMESITE === 'none';

function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    expires: new Date(expiresAt),
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path: '/' });
}

// Derives req.user from the auth-session cookie; never trusts a
// client-supplied user_id anywhere in this file.
function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  const user = auth.getSessionUser(token);
  if (!user) {
    return res.status(401).json({ error: 'authentication required' });
  }
  req.user = user;
  next();
}

// Wraps an async route handler so a thrown/rejected error reaches the
// shared error handler below (clean JSON, no stack trace) instead of
// crashing the process or hanging the request.
function safe(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// --- GET /health --- (no auth required)
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'fitai-backend' });
});

// --- POST /auth/register ---
app.post('/auth/register', safe(async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!auth.isValidEmail(email)) {
    return res.status(400).json({ error: 'a valid email is required' });
  }
  if (!auth.isValidPassword(password)) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const existing = auth.findUserByEmail(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'an account with this email already exists' });
  }

  const id = crypto.randomUUID();
  const passwordHash = await auth.hashPassword(password);

  const tx = db.transaction(() => {
    auth.createUser({ id, email: email.toLowerCase(), passwordHash });
    auth.createProfile({ userId: id, name: name.trim() });
  });
  tx();

  const { token, expiresAt } = auth.createSession(id);
  setSessionCookie(res, token, expiresAt);

  return res.status(201).json({ user: auth.safeUser(auth.findUserById(id)) });
}));

// --- POST /auth/login ---
app.post('/auth/login', safe(async (req, res) => {
  const { email, password } = req.body || {};
  if (!auth.isValidEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = auth.findUserByEmail(email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const ok = await auth.verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'invalid email or password' });
  }

  const { token, expiresAt } = auth.createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  return res.status(200).json({ user: auth.safeUser(user) });
}));

// --- GET /auth/session ---
app.get('/auth/session', safe(async (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  const user = auth.getSessionUser(token);
  if (!user) {
    return res.status(200).json({ authenticated: false });
  }
  return res.status(200).json({ authenticated: true, user: auth.safeUser(user) });
}));

// --- POST /auth/logout ---
app.post('/auth/logout', safe(async (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    auth.destroySession(token);
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}));

// --- GET /workouts (public catalog — no auth required) ---
app.get('/workouts', safe(async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const workouts = catalog.listWorkouts(category);
  return res.status(200).json({ workouts });
}));

// --- GET /workouts/:id (public — no auth required) ---
app.get('/workouts/:id', safe(async (req, res) => {
  const workout = catalog.getWorkoutById(req.params.id);
  if (!workout) {
    return res.status(404).json({ error: 'workout not found' });
  }
  return res.status(200).json(workout);
}));

// ================= Phase 2.3 — Workout Sessions =================
// Every route below requires authentication and scopes to req.user.id;
// none accept a client-supplied user_id.

// --- POST /sessions ---
app.post('/sessions', requireAuth, safe(async (req, res) => {
  const { workout_id, source, ai_generation_id } = req.body || {};

  if (workout_id) {
    const result = sessions.createCatalogSession(req.user.id, workout_id);
    if (result.error) return res.status(404).json({ error: result.error });
    return res.status(201).json({ session: result.session });
  }

  if (source === 'ai') {
    if (typeof ai_generation_id !== 'string' || ai_generation_id.length === 0) {
      return res.status(400).json({ error: 'ai_generation_id is required for an ai session' });
    }
    const result = sessions.createAiSessionFromGeneration(req.user.id, ai_generation_id);
    if (result.error) return res.status(404).json({ error: result.error });
    return res.status(201).json({ session: result.session });
  }

  return res.status(400).json({ error: 'workout_id (catalog) or source="ai" with ai_generation_id is required' });
}));

// --- GET /sessions/current ---
app.get('/sessions/current', requireAuth, safe(async (req, res) => {
  const current = sessions.getCurrentSession(req.user.id);
  return res.status(200).json({ session: current });
}));

// --- POST /sessions/:id/sets ---
app.post('/sessions/:id/sets', requireAuth, safe(async (req, res) => {
  const session = sessions.getOwnedSession(req.params.id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (session.status !== 'in_progress') {
    return res.status(409).json({ error: 'session is not in progress' });
  }

  const { exercise_index, set_index, reps, weight, exercise_name } = req.body || {};
  const exIdx = Number(exercise_index);
  const setIdx = Number(set_index);
  const repsNum = Number(reps);
  const weightNum = Number(weight);
  if (!Number.isInteger(exIdx) || exIdx < 0 || !Number.isInteger(setIdx) || setIdx < 0) {
    return res.status(400).json({ error: 'exercise_index and set_index must be non-negative integers' });
  }
  if (!Number.isFinite(repsNum) || repsNum <= 0 || !Number.isFinite(weightNum) || weightNum < 0) {
    return res.status(400).json({ error: 'reps must be > 0 and weight must be >= 0' });
  }

  const result = sessions.logSet(session, {
    exercise_index: exIdx,
    set_index: setIdx,
    reps: repsNum,
    weight: weightNum,
    exercise_name
  });
  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(result.duplicate ? 200 : 201).json({ set: result.set, duplicate: !!result.duplicate });
}));

// --- POST /sessions/:id/complete ---
app.post('/sessions/:id/complete', requireAuth, safe(async (req, res) => {
  const session = sessions.getOwnedSession(req.params.id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: 'session not found' });
  }
  if (session.status !== 'in_progress') {
    return res.status(409).json({ error: 'session is already completed' });
  }
  const result = sessions.completeSession(session);
  return res.status(200).json(result);
}));

// --- GET /sessions ---
app.get('/sessions', requireAuth, safe(async (req, res) => {
  const list = sessions.listSessions(req.user.id, { status: req.query.status, limit: req.query.limit });
  return res.status(200).json({ sessions: list });
}));

// --- GET /progress ---
app.get('/progress', requireAuth, safe(async (req, res) => {
  const progress = sessions.getProgress(req.user.id);
  return res.status(200).json(progress);
}));

// ================= Phase 2.4 — Real AI Workout Generation =================

const AI_GOALS = ['lose', 'build', 'endurance', 'general'];
const AI_LEVELS = ['beginner', 'intermediate', 'advanced'];

function validateAiInput(body) {
  const { goal, duration_min, fitness_level, workout_type, equipment } = body || {};
  if (typeof goal !== 'string' || AI_GOALS.indexOf(goal) === -1) {
    return { error: 'goal must be one of ' + AI_GOALS.join('/') };
  }
  if (!Number.isInteger(duration_min) || duration_min <= 0 || duration_min > 180) {
    return { error: 'duration_min must be a positive integer up to 180' };
  }
  if (typeof fitness_level !== 'string' || AI_LEVELS.indexOf(fitness_level) === -1) {
    return { error: 'fitness_level must be one of ' + AI_LEVELS.join('/') };
  }
  if (workout_type !== undefined && typeof workout_type !== 'string') {
    return { error: 'workout_type must be a string if provided' };
  }
  if (equipment !== undefined && !Array.isArray(equipment)) {
    return { error: 'equipment must be an array if provided' };
  }
  return { input: { goal, duration_min, fitness_level, workout_type: workout_type || null, equipment: equipment || [] } };
}

// --- POST /ai/generate-workout ---
app.post('/ai/generate-workout', requireAuth, safe(async (req, res) => {
  const validated = validateAiInput(req.body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }
  const input = validated.input;

  const providerResult = await aiProvider.generate(input);
  if (!providerResult.ok) {
    // Record the failure (no secrets, no provider internals) and return
    // a safe, generic error — never the raw provider error or the key.
    aiGenerations.recordGeneration({ userId: req.user.id, input, output: null, status: 'failed' });
    const messages = {
      missing_api_key: 'AI generation is not configured on this server yet.',
      timeout: 'The AI service took too long to respond. Please try again.',
      provider_error: 'The AI service is unavailable right now. Please try again.'
    };
    return res.status(502).json({ error: messages[providerResult.reason] || 'AI generation failed.' });
  }

  const validation = aiValidate.validateAndNormalize(providerResult.raw);
  if (!validation.ok) {
    aiGenerations.recordGeneration({ userId: req.user.id, input, output: null, status: 'failed' });
    return res.status(502).json({ error: 'The AI returned an unusable workout. Please try again.' });
  }

  const generation = aiGenerations.recordGeneration({
    userId: req.user.id,
    input,
    output: validation.workout,
    status: 'generated'
  });

  return res.status(201).json({ generation_id: generation.id, workout: generation.output });
}));

// --- GET /ai/generations (own history only) ---
app.get('/ai/generations', requireAuth, safe(async (req, res) => {
  const list = aiGenerations.listGenerations(req.user.id, req.query.limit);
  return res.status(200).json({ generations: list });
}));

// --- GET /ai/generations/:id (own only — 404 for anyone else's) ---
app.get('/ai/generations/:id', requireAuth, safe(async (req, res) => {
  const generation = aiGenerations.getOwnedGeneration(req.params.id, req.user.id);
  if (!generation) {
    return res.status(404).json({ error: 'generation not found' });
  }
  return res.status(200).json({ generation });
}));

// ================= Phase 2.6 — Profile =================

// --- GET /profile ---
app.get('/profile', requireAuth, safe(async (req, res) => {
  const p = profile.getProfile(req.user.id, req.user.email);
  if (!p) {
    return res.status(404).json({ error: 'profile not found' });
  }
  return res.status(200).json({ profile: p });
}));

// --- PATCH /profile ---
app.patch('/profile', requireAuth, safe(async (req, res) => {
  const result = profile.updateProfile(req.user.id, req.user.email, req.body || {});
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(200).json({ profile: result.profile });
}));

// --- 404: clean JSON instead of Express's default HTML page ---
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// --- Final error handler: never leak internals ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[fitai-backend] unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FitAI backend listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
