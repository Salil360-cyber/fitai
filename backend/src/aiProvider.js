/*
 * Phase 2.4 — real AI provider integration, behind a small abstraction
 * so the provider can be swapped later without touching the endpoint,
 * validator, or frontend. One provider only, per the brief: Anthropic's
 * Messages API (chosen because api.anthropic.com is reachable from this
 * backend's network and needs no extra client library — plain fetch).
 *
 * The API key is read from process.env.AI_API_KEY on the server only.
 * It is never sent to, or readable by, the browser.
 */

const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 20000;

function buildPrompt(input) {
  return [
    'Generate a workout as STRICT JSON ONLY — no prose, no markdown fences, no explanation.',
    'Match this exact shape:',
    '{"name": string, "duration_min": integer, "difficulty": "Beginner"|"Intermediate"|"Advanced", "category": string, "exercises": [{"name": string, "sets": integer, "reps": integer, "rest_sec": integer}]}',
    '',
    'User inputs:',
    `goal: ${input.goal}`,
    `duration_min: ${input.duration_min}`,
    `fitness_level: ${input.fitness_level}`,
    `workout_type: ${input.workout_type || 'not specified'}`,
    `equipment: ${(input.equipment || []).join(', ') || 'none specified'}`,
    '',
    'Keep the exercise count and duration realistic for the requested time. Output ONLY the JSON object, nothing else.'
  ].join('\n');
}

/*
 * Returns one of:
 *   { ok: true, raw: <string> }                 — provider responded
 *   { ok: false, reason: 'missing_api_key' }     — no AI_API_KEY configured
 *   { ok: false, reason: 'provider_error', detail }
 *   { ok: false, reason: 'timeout' }
 * Never throws; never includes the API key in any return value.
 */
async function generate(input) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: 'user', content: buildPrompt(input) }]
      })
    });

    if (!res.ok) {
      let detail = 'provider returned status ' + res.status;
      return { ok: false, reason: 'provider_error', detail };
    }

    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) {
      return { ok: false, reason: 'provider_error', detail: 'empty response content' };
    }
    return { ok: true, raw: text };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'provider_error', detail: 'request failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate };
