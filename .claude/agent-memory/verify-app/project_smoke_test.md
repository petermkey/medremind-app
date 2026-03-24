---
name: smoke test results
description: End-to-end smoke test results for medremind-app routes as of 2026-03-21
type: project
---

Last verified: 2026-03-21

- App starts cleanly with `npm run dev` on port 3000
- GET /login → 200, contains "Sign in" (not "Welcome back" — page uses "Sign in" phrasing)
- GET /register → 200, contains "Create your account"
- GET /auth/callback → redirects to /login?error=oauth → 200 (expected: no valid OAuth params in request)
- GET /app → 200 (no auth redirect at the route level; auth may be handled client-side)
- No crash, no 404s on any tested route
