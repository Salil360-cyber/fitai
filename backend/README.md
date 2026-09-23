# FitAI Backend

Node.js/Express/SQLite backend for FitAI — AI-Powered Fitness & Workout
Companion. Implements authentication, profile, the workout catalog,
workout sessions and set logging, progress, and server-side AI workout
generation.

**Status: deployment-ready backend configuration. Not currently deployed
anywhere.** Everything documented below has been run and verified
locally only.

## What's implemented

- **Auth** — register, login, session check, logout. Bcrypt password
  hashing (cost 12), opaque server-side session tokens in an HttpOnly
  cookie — never a password, hash, or token in any response or in
  localStorage.
- **Profile** — authenticated GET/PATCH of name, fitness goal, fitness
  level, and preferences.
- **Workout catalog** — public GET of the seeded workout list and
  per-workout detail with ordered exercises.
- **Workout sessions** — start a session (catalog or AI-sourced), log
  sets (with duplicate-submission protection and server-side exercise
  name resolution), complete a session (server computes duration from
  real timestamps), list a user's session history.
- **Progress** — workouts-this-week / streak / completed-sets, computed
  server-side from real completed sessions — never fabricated.
- **AI workout generation** — `POST /ai/generate-workout` calls a real
  AI provider server-side, strictly validates and normalizes the
  response before it ever reaches the database or the client, and
  records every attempt (succeeded or failed) in `ai_generations`. The
  API key never reaches the frontend.

Every authenticated route derives its user from the session cookie only
— no endpoint anywhere accepts a client-supplied `user_id`, and
ownership is enforced on every session/profile/AI-generation lookup.

## Project structure

```
backend/
  src/
    server.js         entrypoint (see package.json "main"/"start")
    db.js             SQLite connection, schema init, safe migrations, seed
    schema.sql        table definitions
    seed.js           idempotent catalog seed data
    auth.js           password hashing, session tokens
    profile.js        profile validation + persistence
    catalog.js        workout catalog queries
    sessions.js        workout session / set logging / progress logic
    aiProvider.js     real AI provider call (Anthropic Messages API)
    aiValidate.js     strict AI-output validation/normalization
    aiGenerations.js  ai_generations persistence
  package.json
  package-lock.json
  .env.example
  .gitignore
```

The real entrypoint is `src/server.js` — `package.json`'s `main` and
`start`/`dev` scripts already point there, so `npm start` works correctly
from `backend/` without any path changes.

## Deployment checklist

**1. Node version:** 18+ (`package.json`'s `engines` field; needed for
native `crypto.randomUUID` and to match `better-sqlite3`'s prebuilt
binaries).

**2. Install:**
```
npm ci
```

**3. Environment variables** (copy `.env.example` to `.env`, or set
these directly on your hosting platform):

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No (defaults 4000) | port the server listens on |
| `DB_FILE` | Recommended in prod | SQLite file path — see persistence warning below |
| `NODE_ENV` | No | informational only |
| `ALLOWED_ORIGIN` | Yes, for browser use | exact origin allowed to call this API with credentials (e.g. the Artifact frontend's origin) |
| `COOKIE_SECURE` | No | `true` to force the Secure cookie flag (auto-forced on anyway if `COOKIE_SAMESITE=none`) |
| `COOKIE_SAMESITE` | Yes, for cross-origin | `lax` (default, same-origin/dev) or `none` (required for the current Artifact-hosted frontend, a different origin, to receive the session cookie at all) |
| `AI_API_KEY` | Yes, for real AI generation | server-side only; without it `/ai/generate-workout` returns a clean, safe error and the frontend uses its clearly-labeled offline fallback instead |

**4. Database persistence — read this before deploying.** SQLite is a
single file (`DB_FILE`, default `./data/fitai.sqlite`). If your hosting
platform's filesystem is ephemeral (many container/serverless platforms
wipe local disk on every redeploy or restart), **all data will be lost**
on the next deploy. Point `DB_FILE` at a persistent volume/disk the
platform provides before real users register. Do not assume the default
filesystem is production-safe without checking your specific platform's
docs.

**5. HTTPS is required in production.** Cross-origin cookies
(`COOKIE_SAMESITE=none`) are rejected by browsers unless sent over
HTTPS — not optional once the frontend and API are on different
origins, which is the current FitAI deployment shape.

**6. Start command:**
```
npm start
```

**7. Health check URL:** `GET /health` → `{"ok":true,"service":"fitai-backend"}`,
no authentication required.

**8. Connecting the frontend:** the frontend never hardcodes a backend
URL. Once deployed with `COOKIE_SAMESITE=none`, `COOKIE_SECURE`
effectively true, and `ALLOWED_ORIGIN` set to the frontend's exact
origin, set `window.FITAI_API_BASE = 'https://your-api-host'` wherever
the frontend is hosted, before `api-client.js` loads. Until that's set,
every board correctly falls back to its existing local-only prototype
behavior — this is intentional, not a bug.

**9. Smoke-test sequence** (run after any deploy):
```
curl -i https://your-api-host/health
curl -i -c cookies.txt -X POST https://your-api-host/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"password123"}'
curl -i -b cookies.txt https://your-api-host/auth/session
curl -i -b cookies.txt https://your-api-host/profile
curl -i -b cookies.txt https://your-api-host/workouts
curl -i -b cookies.txt -X POST https://your-api-host/auth/logout
curl -i -b cookies.txt https://your-api-host/auth/session   # should show authenticated:false
```

**10. Data safety on deploy:** this codebase never runs a destructive
migration or drops a table — `db.js` only ever uses
`CREATE TABLE IF NOT EXISTS` plus one additive, idempotent
`ALTER TABLE ... ADD COLUMN` (guarded by a `PRAGMA table_info` check)
for the `ai_generation_id` column. Deploying against an existing
production database will not touch any existing data.

**11. Frontend runtime note:** this backend is independently deployable
to any Node host. The current FitAI frontend (the `.dc.html` boards) is
**not** independently deployable — it depends on Claude's Artifact
runtime (`support.js`, the `DCLogic`/`<x-dc>` templating system) and is
not currently a standalone static website. See the repository root
README for details. Deploying this backend does not require or imply
the frontend can move off Artifact hosting.

---

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | health check |
| POST | `/auth/register` | No | create account + session |
| POST | `/auth/login` | No | authenticate + session |
| GET | `/auth/session` | No | check current session |
| POST | `/auth/logout` | No | invalidate session |
| GET | `/profile` | Yes | fetch own profile |
| PATCH | `/profile` | Yes | update own profile |
| GET | `/workouts` | No | catalog list, optional `?category=` |
| GET | `/workouts/:id` | No | catalog detail + exercises |
| POST | `/sessions` | Yes | start a workout session (catalog or AI) |
| GET | `/sessions/current` | Yes | own in-progress session |
| POST | `/sessions/:id/sets` | Yes | log a set (own session only) |
| POST | `/sessions/:id/complete` | Yes | complete own session |
| GET | `/sessions` | Yes | own session history, `?status=&limit=` |
| GET | `/progress` | Yes | own real progress metrics |
| POST | `/ai/generate-workout` | Yes | real AI generation (safe error if unconfigured) |
| GET | `/ai/generations` | Yes | own generation history |
| GET | `/ai/generations/:id` | Yes | own generation detail |

## Security notes

- Passwords hashed with bcrypt, cost factor 12. Plaintext password
  never stored or logged.
- `password_hash` is never included in any API response.
- Sessions are opaque random tokens (not JWTs) stored server-side, set
  as an HttpOnly cookie — never placed in localStorage.
- Every authenticated endpoint derives the user from the session
  cookie only; no endpoint accepts or trusts a client-supplied
  `user_id`.
- `AI_API_KEY` is read server-side only and never appears in any
  response.
- All unexpected errors return a generic
  `{"error":"internal server error"}` (logged server-side only);
  malformed request bodies and unknown routes also return clean JSON,
  never a stack trace or Express's default HTML error page.
