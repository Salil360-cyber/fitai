/*
 * FitAI — authentication, catalog, sessions, profile, and AI API client.
 *
 * This copy is served by the SAME Express app as the backend API
 * (frontend-web/, served via express.static — see server.js), so it
 * defaults to the current page's own origin rather than an external
 * URL: wherever this file is loaded from (localhost during dev, the
 * live Render URL in production) IS the API's origin, by construction.
 * The `||` still allows an earlier inline script to override it.
 *
 * This is ADDITIVE: it does not modify store.js or its localStorage
 * behavior in any way. store.js remains the working, self-contained
 * local prototype exactly as it was.
 *
 * If a request ever fails (network error, cold-start timeout, 5xx),
 * every function below still resolves to { ok: false, offline: true }
 * without throwing, so pages fall back to the existing local-only flow.
 */
(function (global) {
  global.FITAI_API_BASE = global.FITAI_API_BASE || global.location.origin;

  function apiBase() {
    return global.FITAI_API_BASE || '';
  }

  async function call(path, options) {
    var base = apiBase();
    if (!base) {
      return { ok: false, offline: true, unconfigured: true };
    }
    try {
      var res = await fetch(base + path, Object.assign({
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      }, options || {}));
      var data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }
      return { ok: res.ok, status: res.status, data: data, offline: false, unconfigured: false };
    } catch (e) {
      return { ok: false, offline: true, unconfigured: false, error: String(e) };
    }
  }

  function register(name, email, password) {
    return call('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
  }

  function login(email, password) {
    return call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  function getSession() {
    return call('/auth/session', { method: 'GET' });
  }

  function logout() {
    return call('/auth/logout', { method: 'POST' });
  }

  function listWorkouts(category) {
    var qs = category ? ('?category=' + encodeURIComponent(category)) : '';
    return call('/workouts' + qs, { method: 'GET' });
  }

  function getWorkout(id) {
    return call('/workouts/' + encodeURIComponent(id), { method: 'GET' });
  }

  function startSession(workoutId) {
    return call('/sessions', { method: 'POST', body: JSON.stringify({ workout_id: workoutId }) });
  }

  function startAiSession(aiGenerationId) {
    return call('/sessions', { method: 'POST', body: JSON.stringify({ source: 'ai', ai_generation_id: aiGenerationId }) });
  }

  function getCurrentSession() {
    return call('/sessions/current', { method: 'GET' });
  }

  function logSet(sessionId, payload) {
    return call('/sessions/' + encodeURIComponent(sessionId) + '/sets', { method: 'POST', body: JSON.stringify(payload) });
  }

  function completeSession(sessionId) {
    return call('/sessions/' + encodeURIComponent(sessionId) + '/complete', { method: 'POST' });
  }

  function getSessions(params) {
    params = params || {};
    var qs = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    return call('/sessions' + (qs ? '?' + qs : ''), { method: 'GET' });
  }

  function getProgress() {
    return call('/progress', { method: 'GET' });
  }

  function generateWorkout(input) {
    return call('/ai/generate-workout', { method: 'POST', body: JSON.stringify(input) });
  }

  function getProfile() {
    return call('/profile', { method: 'GET' });
  }

  function updateProfile(data) {
    return call('/profile', { method: 'PATCH', body: JSON.stringify(data) });
  }

  /*
   * Phase 2.6 — lightweight page guard for screens that require auth.
   * Only ENFORCES anything once a real backend is configured
   * (window.FITAI_API_BASE set) — with no backend configured at all,
   * there is no real authentication system running, so every screen
   * continues in the existing local-prototype mode exactly as before
   * (this preserves the offline demo every earlier phase relied on).
   * Once a backend IS configured, the backend session is authoritative:
   * an unauthenticated visit to a protected page redirects to Login
   * immediately, with the intended destination passed as a plain query
   * param (never localStorage) so Login can return the user afterward.
   */
  async function guardPage() {
    if (!apiBase()) {
      return { ok: true, enforced: false, authenticated: false };
    }
    var result = await getSession();
    if (result.ok && result.data && result.data.authenticated) {
      return { ok: true, enforced: true, authenticated: true, user: result.data.user };
    }
    var here = (global.location.pathname.split('/').pop() || 'Home.html');
    global.location.href = 'LoginScreen.html?redirect=' + encodeURIComponent(here);
    return { ok: false, enforced: true, authenticated: false };
  }

  global.FitAIAuth = { register, login, getSession, logout, apiBase, guardPage };
  global.FitAICatalog = { listWorkouts, getWorkout };
  global.FitAISessions = { startSession, startAiSession, getCurrentSession, logSet, completeSession, getSessions, getProgress };
  global.FitAIAI = { generateWorkout };
  global.FitAIProfile = { getProfile, updateProfile };
})(window);
