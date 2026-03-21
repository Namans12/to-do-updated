# Project Guidelines

## Architecture
- This workspace has two primary apps: `app/` (Hono + Drizzle + SQLite backend) and `frontend/` (React + Vite web app), plus optional native wrappers under `frontend/src-tauri/` and `frontend/android/`.
- Backend API routes are mounted in `app/src/app.ts`; add new route modules under `app/src/routes/` and mount them via `app.route(...)`.
- Frontend shared domain types live in `frontend/src/types/index.ts`; keep API payload and UI model changes aligned with backend schema and routes.
- Domain behavior and business rules are defined in `docs/rules.md`; follow those rules when changing ordering, connections, reminders, or GraphPlan behavior.

## Build And Test
- Backend setup and run:
  - `cd app && npm install`
  - `npm run dev` (watch server)
  - `npm run test` (Vitest)
  - `npm run build` (TypeScript compile)
- Frontend setup and run:
  - `cd frontend && npm install`
  - `npm run dev` (Vite on port 3000; proxies `/api` and `/health` to backend on 8080)
  - `npm run build`
  - `npm run test:e2e` (Playwright; starts frontend + backend web servers)
- Database migration workflow (backend):
  - `cd app && npm run db:generate`
  - `npm run db:migrate`

## Conventions
- Prefer small, modular backend route factories and keep them testable with optional DB override patterns (see `app/src/tests/helpers.ts` and existing `create*Router` modules).
- For backend tests, use isolated temporary SQLite DB contexts and ensure cleanup of DB files (`.db`, `-wal`, `-shm`).
- Keep TypeScript style consistent with existing code: explicit imports, named exports, and focused utility functions under `app/src/lib/` or `frontend/src/utils/`.
- Keep endpoint changes synchronized end-to-end: backend route, frontend API client usage, and relevant tests.

## Pitfalls
- Do not edit generated or tool-managed artifacts unless the task explicitly requires it:
  - `frontend/android/`
  - `frontend/src-tauri/gen/`
  - build outputs like `dist/` and temporary tool directories
- Treat runtime data carefully; avoid destructive edits in:
  - `data/` (SQLite DB, backups, templates)
- Preserve dev server assumptions:
  - Backend health endpoint `/health` on port `8080`
  - Frontend dev server on port `3000` with proxy for `/api` and `/health`
- When schema changes are required, update Drizzle schema first, then regenerate and apply migrations; avoid hand-editing generated migration SQL unless absolutely necessary.

## Key References
- Backend app composition: `app/src/app.ts`
- Backend test pattern: `app/src/tests/helpers.ts`
- Frontend API/proxy behavior: `frontend/vite.config.ts`
- E2E environment and web servers: `frontend/playwright.config.ts`
- Domain rules: `docs/rules.md`
