# FitAI — Source Package

**FitAI** is an AI-powered fitness/workout companion — a self-initiated
UX/UI case study and working prototype. This repository contains the
current, complete source as of Phase 2.7: a Node.js/Express/SQLite
backend and a frontend built on Claude's Artifact "Design" canvas format
(`.dc.html` boards).

## What's implemented

- Authentication (register/login/session/logout) and an authenticated
  profile API
- A workout catalog, workout sessions, set logging (with duplicate
  protection), and completion
- Real progress metrics computed from actual session data
- Server-side AI workout generation — the frontend never talks to the
  AI provider directly; `AI_API_KEY` lives only in the backend's hosting
  environment, never in this repository or in any frontend file
- A clearly-labeled offline/local fallback for every one of the above,
  so the prototype keeps working even without a deployed backend

See `backend/README.md` for the full endpoint list and deployment
checklist.

## Structure

```
backend/     Node.js/Express API — see backend/README.md for full
             deployment instructions (env vars, CORS, cookies, AI key,
             persistence requirements, smoke-test sequence).
frontend/    The 20 .dc.html boards, store.js, api-client.js, canvas.json.
```

## IMPORTANT — frontend hosting constraint

The `.dc.html` files are **not** plain static HTML. Each one loads
`./support.js` and relies on a small custom-element/template runtime
(`<x-dc>`, the `DCLogic` component base class, `{{hole}}` bindings,
`<sc-if>`/`<sc-for>`) that is provided by Claude's Artifact hosting
environment — the same environment currently serving the published,
working version of this frontend. **`support.js` is not included in this
package** because it was never provided to or authored by this project;
it belongs to the hosting runtime, not the application source.

Practically, this means:
- The **backend** (`backend/`) is a standard Node/Express app and will run
  correctly on Render (or any Node host) from a clean checkout — verified
  in this audit.
- The **frontend** (`frontend/`) will continue working exactly as it does
  today as long as it stays on Claude's Artifact hosting. Deploying it
  as plain static files on Render/GitHub Pages/Netlify will **not** render
  correctly as-is, since the runtime those boards depend on wouldn't be
  present. Making the frontend independently deployable would require
  building or sourcing an equivalent runtime — that is a separate task,
  out of scope for this audit/export.

## Frontend ↔ backend connection

The frontend never hardcodes a backend URL. `api-client.js` reads
`window.FITAI_API_BASE`, which is unset by default — in that state every
board falls back to its existing local-only prototype behavior (unchanged
from every prior phase). Once a backend is deployed, set
`window.FITAI_API_BASE = 'https://your-backend-host'` wherever the
frontend is hosted to connect it for real.

## Secrets

No `.env` file, API key, password, or session token is included anywhere
in this package. See `backend/.env.example` for the full list of required
environment variable *names* (no values) and `backend/.gitignore` for what
Git must never track.
