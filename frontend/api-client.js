/*
 * FitAI — authentication, catalog, sessions, profile, and AI API client.
 *
 * This is ADDITIVE: it does not modify store.js or its localStorage
 * behavior in any way. store.js remains the working, self-contained
 * local prototype exactly as it was.
 *
 * window.FITAI_API_BASE is unset by default. Until a real backend is
 * deployed and this is set (e.g. window.FITAI_API_BASE =
 * 'https://api.yourdomain.com'), every function below resolves to
 * { ok: false, offline: true } without throwing, so boards that call
 * it can safely fall back to the existing local-only flow.
 */
(function (global) {
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
    var here = (global.location.pathname.split('/').pop() || 'Home.dc.html');
    global.location.href = 'LoginScreen.dc.html?redirect=' + encodeURIComponent(here);
    return { ok: false, enforced: true, authenticated: false };
  }

  global.FitAIAuth = { register, login, getSession, logout, apiBase, guardPage };
  global.FitAICatalog = { listWorkouts, getWorkout };
  global.FitAISessions = { startSession, startAiSession, getCurrentSession, logSet, completeSession, getSessions, getProgress };
  global.FitAIAI = { generateWorkout };
  global.FitAIProfile = { getProfile, updateProfile };
})(window);
