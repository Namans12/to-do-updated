# Live Sync PWA on Supabase

## Runtime mode

The frontend now supports two runtimes:

- `Supabase sync mode`
  - enabled when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` exist
  - uses Supabase Auth, Postgres, Realtime, IndexedDB cache, and a local offline queue
- `Local REST fallback mode`
  - used when Supabase env vars are absent
  - keeps the current Hono/SQLite runtime working for local development and regression tests

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy `frontend/.env.example` to `.env.local`.
4. Fill:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. In Supabase Auth, enable `email` sign-in with magic links.
6. Add your local/dev and production app URLs to the Supabase redirect allow-list.

## Current synced surface

In Supabase mode, these app areas run from the cloud-backed frontend data layer:

- auth shell with email magic link
- groups CRUD and reorder
- todos CRUD, complete, reorder, reminders, trash
- connections CRUD and graph-backed connection updates
- search
- recent activity
- realtime refresh across devices
- offline cached reads
- queued offline writes with ordered replay

## Conflict rule

- Last write wins.
- Queued offline updates carry the entity `baseUpdatedAt`.
- If a newer remote version already exists when replay happens, the queued change is skipped and a local sync activity entry is written.

## Offline behavior

- Reads come from IndexedDB cache when offline.
- Writes are applied optimistically to the cached snapshot and queued locally.
- When the browser comes back online, queued operations replay automatically in order.

## PWA

The frontend now builds with `vite-plugin-pwa` and emits:

- manifest
- service worker
- installable metadata

Installability still depends on the browser and deployment environment using HTTPS or localhost.

## Supabase E2E

Use the hosted-backend Playwright profile (frontend only):

- set `VITE_SUPABASE_URL`
- set `VITE_SUPABASE_ANON_KEY`
- run `cd frontend && npm run test:e2e:supabase`

## Legacy/local-only helpers

These areas still rely on the legacy REST backend until Supabase parity is finished:

- manual backup snapshots
- manual sync package export/import
- template/local tooling that still targets the existing backend path

That is intentional for now so the current local workflow and test suite continue to work while Supabase becomes the primary shipped runtime.
