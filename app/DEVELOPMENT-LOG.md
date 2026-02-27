# Development Log — Nodes To-Do

This file tracks the progress of features implemented by the Ralph loop.

---

## Completed Features

### Feature 1: Project Scaffolding & Database Setup
**Status:** Complete
**Date:** 2025-02-16

**What was implemented:**
- Initialized the project with TypeScript, Hono, better-sqlite3, Drizzle ORM, and Vitest
- Created `package.json` with all required dependencies and scripts (`dev`, `start`, `test`, `build`, `db:generate`, `db:migrate`)
- Created `tsconfig.json` with strict mode enabled
- Created Drizzle ORM schema (`src/db/schema.ts`) matching all 4 tables: `groups`, `todos`, `connections`, `connection_items`
- Created database connection module (`src/db/connection.ts`) with SQLite pragmas (WAL mode, synchronous=NORMAL, foreign keys ON)
- Created migration script (`src/db/migrate.ts`) that creates all 4 tables with IF NOT EXISTS (idempotent)
- Created Hono server (`src/app.ts`, `src/index.ts`) on port 8080 with `GET /health` endpoint returning `{ status: "ok" }`
- Created Vitest configuration (`vitest.config.ts`)
- Created `.gitignore` for node_modules, dist, data, db files
- Added graceful shutdown handler that closes DB connection on SIGINT/SIGTERM
- Drizzle Kit config (`drizzle.config.ts`) for future migration generation

**Files created:**
- `package.json` — project config with all dependencies and scripts
- `tsconfig.json` — TypeScript strict mode config
- `vitest.config.ts` — Vitest test runner config
- `drizzle.config.ts` — Drizzle Kit migration config
- `.gitignore` — Git ignore rules
- `src/index.ts` — Main entry point, starts server on port 8080
- `src/app.ts` — Hono app factory with health endpoint
- `src/db/schema.ts` — Drizzle ORM schema for all 4 tables
- `src/db/connection.ts` — SQLite connection with pragmas, singleton pattern
- `src/db/migrate.ts` — Migration script to create tables
- `src/tests/health.test.ts` — Tests for health endpoint (2 tests)
- `src/tests/database.test.ts` — Tests for database setup, schema, pragmas (13 tests)

**Test results:**
- 15 tests passing (2 health endpoint + 13 database/schema tests)
- All acceptance criteria met:
  - [x] `package.json` with all dependencies
  - [x] `tsconfig.json` with strict mode
  - [x] Drizzle schema files matching the spec
  - [x] Migration script that creates all 4 tables
  - [x] Vitest config present
  - [x] `npm run dev` starts the Hono server on port 8080
  - [x] Server responds to `GET /health` with `{ status: "ok" }`
  - [x] Tests verifying health endpoint and database setup

### Feature 2: Groups CRUD API
**Status:** Complete
**Date:** 2026-02-16

**What was implemented:**
- Created Groups CRUD routes at `src/routes/groups.ts` with all 6 endpoints:
  - `POST /api/groups` — Create a group (auto-positions at end of list)
  - `GET /api/groups` — List all groups sorted by position
  - `GET /api/groups/:id` — Get a single group by ID
  - `PATCH /api/groups/:id` — Update group name (with validation)
  - `DELETE /api/groups/:id` — Delete group and cascade-delete its todos
  - `PATCH /api/groups/reorder` — Reorder groups via array of `{ id, position }` (transactional)
- Updated `src/app.ts` to mount group routes under `/api/groups` with dependency injection support for test DB override
- Created shared test helper `src/tests/helpers.ts` for isolated test DB setup/teardown
- All responses follow `{ data: ... }` or `{ error: string }` shape per spec
- Validation: name required, non-empty, max 100 chars, unique, trimmed
- Reorder runs in a SQLite transaction for atomicity
- Delete group cascade-deletes all associated todos (hard delete required due to FK constraint on `group_id`)

**Files created/changed:**
- `src/routes/groups.ts` — Groups CRUD route handlers (new)
- `src/tests/groups.test.ts` — 27 tests for all group endpoints (new)
- `src/tests/helpers.ts` — Shared test context helper with isolated test DB (new)
- `src/app.ts` — Updated to mount groups router, added DB override support

**Test results:**
- 42 tests passing (15 existing + 27 new groups tests)
- All acceptance criteria met:
  - [x] All 6 endpoints return correct status codes and JSON
  - [x] Creating a group auto-sets position to end of list
  - [x] Deleting a group cascades delete to all its todos
  - [x] Reorder accepts an array of `{ id, position }` and updates in a transaction
  - [x] Validation: name required, non-empty, max 100 chars
  - [x] Tests for each endpoint (happy path + error cases)

**Design decisions:**
- Group deletion performs hard-delete of associated todos (not soft-delete) because `group_id` is a required FK — soft-deleted todos cannot exist without their group. This is consistent with the trash system (restoring a todo requires its group to exist).
- The app factory `createApp()` now accepts an optional `dbOverride` parameter, enabling tests to run against isolated in-memory/temp databases without touching the main DB.

### Feature 3: Todos CRUD API
**Status:** Complete
**Date:** 2026-02-16

**What was implemented:**
- Created Todos CRUD routes split across two routers in `src/routes/todos.ts`:
  - `createGroupTodosRouter` — Group-scoped routes mounted at `/api/groups/:groupId/todos`:
    - `POST /api/groups/:groupId/todos` — Create a to-do in a group (auto-capitalizes title, auto-positions at end)
    - `GET /api/groups/:groupId/todos` — List todos in a group sorted by position (excludes soft-deleted by default)
  - `createTodosRouter` — Direct todo routes mounted at `/api/todos`:
    - `GET /api/todos/:id` — Get a single to-do by ID (includes soft-deleted)
    - `PATCH /api/todos/:id` — Update title and/or description (auto-capitalizes title)
    - `PATCH /api/todos/:id/complete` — Toggle completion status (0↔1)
    - `DELETE /api/todos/:id` — Soft-delete (sets `deleted_at`, never hard-deletes)
    - `PATCH /api/todos/reorder` — Reorder todos via array of `{ id, position }` (transactional)
- Updated `src/app.ts` to mount both todo routers
- Auto-capitalization: `title.charAt(0).toUpperCase() + title.slice(1)` applied on create and update
- Soft-deleted todos excluded from list queries by default; `?include_deleted=true` query param to include them
- Validation: title required, non-empty, max 500 chars; group must exist for creation
- All responses follow `{ data: ... }` or `{ error: string }` shape per spec

**Files created/changed:**
- `src/routes/todos.ts` — Todos CRUD route handlers with two routers (new)
- `src/tests/todos.test.ts` — 45 tests for all todo endpoints (new)
- `src/app.ts` — Updated to mount group-scoped and direct todo routers

**Test results:**
- 87 tests passing (42 existing + 45 new todos tests)
- All acceptance criteria met:
  - [x] All endpoints return correct status codes and JSON
  - [x] Title is auto-capitalized (first character uppercased) on create and update
  - [x] Creating a to-do auto-sets position to end of group list
  - [x] Soft-deleted todos are excluded from list queries by default
  - [x] Completing a to-do sets `is_completed = 1` and updates `updated_at`
  - [x] Toggling completion back to 0 works correctly
  - [x] Validation: title required, non-empty, max 500 chars; group must exist
  - [x] Tests for each endpoint (happy path + error cases)

**Design decisions:**
- Split into two routers (`createGroupTodosRouter` and `createTodosRouter`) because Hono mounts routes at a base path — group-scoped routes need `/api/groups/:groupId/todos` while direct routes need `/api/todos`. Both accept the same `dbOverride` for test isolation.
- Soft-delete prevents accidental data loss. `DELETE /api/todos/:id` returns 400 if the todo is already soft-deleted, preventing double-delete confusion.
- `GET /api/todos/:id` returns soft-deleted todos (useful for trash/restore features in Feature 4). The list endpoint (`GET /api/groups/:groupId/todos`) filters them out by default.
- Reorder endpoint returns a success message rather than the full list (unlike groups reorder) since todos may span different groups. Callers should re-fetch the list if needed.

### Feature 4: Trash & Auto-Purge System
**Status:** Complete
**Date:** 2026-02-16

**What was implemented:**
- Created Trash routes at `src/routes/trash.ts` with all 4 endpoints:
  - `GET /api/trash` — List all soft-deleted todos with `days_until_purge` field (computed from `deleted_at` + 30-day window)
  - `POST /api/trash/:id/restore` — Restore a soft-deleted todo (clears `deleted_at`, returns todo to its group)
  - `DELETE /api/trash/:id` — Permanently hard-delete a single trashed todo (removes row + orphaned connection_items)
  - `DELETE /api/trash` — Empty entire trash permanently (hard-deletes all soft-deleted todos, cleans up connection_items, runs WAL checkpoint + VACUUM)
- Created `runAutoPurge()` function that finds and permanently deletes todos with `deleted_at` older than 30 days, cleans up orphaned `connection_items`, and runs `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM`
- Created `startAutoPurgeScheduler()` function that runs `runAutoPurge()` immediately on startup and then every 6 hours (21,600,000 ms) via `setInterval`
- Updated `src/app.ts` to mount trash router at `/api/trash`
- Updated `src/index.ts` to start the auto-purge scheduler on server startup and clear the interval on graceful shutdown
- All responses follow `{ data: ... }` or `{ error: string }` shape per spec
- Trash list computes `days_until_purge` dynamically on read (not stored)
- Permanent delete operations run in SQLite transactions for atomicity

**Files created/changed:**
- `src/routes/trash.ts` — Trash CRUD route handlers + auto-purge functions (new)
- `src/tests/trash.test.ts` — 29 tests for all trash endpoints and purge logic (new)
- `src/app.ts` — Updated to import and mount trash router at `/api/trash`
- `src/index.ts` — Updated to start auto-purge scheduler on startup and clean up on shutdown

**Test results:**
- 116 tests passing (87 existing + 29 new trash tests)
- All acceptance criteria met:
  - [x] Trash list shows all soft-deleted todos with remaining days until purge
  - [x] Restore clears `deleted_at` and returns the todo to its group
  - [x] Permanent delete removes the row from DB entirely
  - [x] Auto-purge runs on server startup and every 6 hours
  - [x] Auto-purge deletes rows where `deleted_at` is older than 30 days
  - [x] After permanent delete, no trace in DB (todo row + connection_items removed)
  - [x] Run `VACUUM` after bulk purge to reclaim space
  - [x] Tests for purge logic with mocked dates (8 purge-specific tests)

**Design decisions:**
- `days_until_purge` is computed at query time from `deleted_at` timestamp, never stored. Uses `Math.ceil()` so users see whole days remaining (e.g., 29.1 days shows as 30).
- `runAutoPurge()` is exported as a standalone function (not just a route handler) so it can be tested directly and called from the scheduler without HTTP overhead.
- Permanent delete endpoints (single and bulk) clean up `connection_items` referencing the deleted todo(s) before removing the todo row, preventing FK constraint violations.
- The empty-trash endpoint (`DELETE /api/trash`) runs WAL checkpoint + VACUUM after bulk deletion to reclaim disk space. Single-item deletes skip VACUUM to avoid unnecessary overhead.
- Auto-purge scheduler uses `setInterval` with a reference stored for cleanup during graceful shutdown (`clearInterval` in the shutdown handler).
- The `startAutoPurgeScheduler()` wraps each purge call in try/catch to prevent scheduler crashes from affecting the server.

### Feature 5: Node Connections API
**Status:** Complete
**Date:** 2026-02-16

**What was implemented:**
- Created Connections CRUD routes at `src/routes/connections.ts` with all 7 endpoints:
  - `POST /api/connections` — Create a connection with `{ name?, todoIds: string[] }` (minimum 2 items, auto-assigns positions)
  - `GET /api/connections` — List all connections with items and computed progress stats
  - `GET /api/connections/:id` — Get a single connection with items and progress
  - `PATCH /api/connections/:id` — Update connection name (supports string or null)
  - `POST /api/connections/:id/items` — Add a todo to an existing connection (auto-positions at end)
  - `DELETE /api/connections/:id/items/:todoId` — Remove a todo from a connection (auto-deletes connection when last item removed)
  - `DELETE /api/connections/:id` — Delete a connection without deleting the linked todos
- Updated `src/app.ts` to mount connections router at `/api/connections`
- Progress is computed at query time: `{ total, completed, percentage, is_fully_complete }`
- Soft-deleted todos are excluded from progress calculations (via INNER JOIN + isNull(deleted_at))
- Uniqueness enforced: a todo can belong to at most one connection (checked before insert)
- All responses follow `{ data: ... }` or `{ error: string }` shape per spec
- All write operations involving multiple tables use SQLite transactions for atomicity

**Files created/changed:**
- `src/routes/connections.ts` — Connections CRUD route handlers with 7 endpoints (new)
- `src/tests/connections.test.ts` — 47 tests covering all endpoints, progress calculation, edge cases, uniqueness constraints, and integration workflows (new)
- `src/app.ts` — Updated to import and mount connections router at `/api/connections`

**Test results:**
- 163 tests passing (116 existing + 47 new connections tests)
- All acceptance criteria met:
  - [x] Create connection accepts `{ name?, todoIds: string[] }` with at least 2 items
  - [x] Progress is computed on read (completed / total × 100)
  - [x] `is_fully_complete` is true when all connected todos are completed
  - [x] A todo can belong to at most one connection
  - [x] Removing the last item from a connection auto-deletes the connection
  - [x] Deleting a connection does NOT delete the todos themselves
  - [x] Tests for progress calculation, CRUD, and edge cases (47 tests)

**Design decisions:**
- Progress excludes soft-deleted todos by using an INNER JOIN with `isNull(todos.deleted_at)`. This means a soft-deleted todo effectively vanishes from the connection's progress without needing manual cleanup.
- The `buildConnectionResponse()` helper centralizes the response shape computation, ensuring consistency across all endpoints that return connection data.
- The uniqueness constraint on `todo_id` in `connection_items` is enforced at both the application level (checked before insert) and the database level (unique column), providing defense-in-depth.
- When the last item is removed from a connection via the remove-item endpoint, the connection is automatically deleted in a transaction. This prevents orphaned connections with zero items.
- Connection creation and deletion use SQLite transactions to ensure atomicity when inserting/deleting across `connections` and `connection_items` tables.
- Percentage is computed with `Math.round()` for clean integer percentages (e.g., 33%, 67%, 100%).

### Feature 6: Auto-Save & Data Persistence Guarantees
**Status:** Complete
**Date:** 2026-02-17

**What was implemented:**
- Audited all route files and wrapped remaining non-transactional multi-step write operations in SQLite transactions:
  - `POST /api/groups` — Group creation now wraps max-position read + insert in a transaction to prevent race conditions on position assignment
  - `POST /api/groups/:groupId/todos` — Todo creation now wraps max-position read + insert in a transaction for the same reason
- Verified all existing multi-table write operations already use transactions:
  - `PATCH /api/groups/reorder` — ✅ transactional
  - `DELETE /api/groups/:id` — ✅ transactional (cascade-delete todos + delete group)
  - `PATCH /api/todos/reorder` — ✅ transactional
  - `DELETE /api/trash/:id` — ✅ transactional (delete connection_items + delete todo)
  - `DELETE /api/trash` — ✅ transactional (bulk delete connection_items + todos)
  - `runAutoPurge()` — ✅ transactional (delete expired connection_items + todos)
  - `POST /api/connections` — ✅ transactional (create connection + items)
  - `DELETE /api/connections/:id` — ✅ transactional (delete items + connection)
  - `DELETE /api/connections/:id/items/:todoId` — ✅ transactional (when last item triggers connection deletion)
- Verified SQLite pragmas are set on every connection in `src/db/connection.ts`:
  - `PRAGMA journal_mode=WAL` — crash-safe write-ahead logging
  - `PRAGMA synchronous=NORMAL` — safe with WAL, better performance than FULL
  - `PRAGMA foreign_keys=ON` — enforces referential integrity
- Verified graceful shutdown in `src/index.ts`: closes DB connection on SIGINT/SIGTERM, clears auto-purge interval
- Verified no in-memory caching of mutable data — all reads go directly to SQLite via Drizzle ORM
- Created comprehensive persistence test suite (`src/tests/persistence.test.ts`) with 20 tests covering:
  - SQLite pragma verification (WAL, synchronous, foreign keys, FK enforcement at runtime, pragmas on every new connection)
  - Data persistence across close/reopen cycles (groups, todos, completion status, connections/items, soft-delete status)
  - Transaction rollback guarantees (group creation, todo creation)
  - Atomic position assignment via API (sequential group positions, sequential todo positions)
  - No in-memory caching verification (ORM sees raw SQL changes immediately, deletes reflected without cache)
  - Graceful shutdown verification (close prevents further operations, data survives reopen)
  - WAL mode durability (WAL file creation, data recovery after checkpoint)
  - End-to-end persistence via API (create group + todo + complete via API, close, reopen, verify all data persisted)

**Files created/changed:**
- `src/routes/groups.ts` — Wrapped group creation (position read + insert) in SQLite transaction
- `src/routes/todos.ts` — Wrapped todo creation (position read + insert) in SQLite transaction
- `src/tests/persistence.test.ts` — 20 comprehensive persistence and durability tests (new)

**Test results:**
- 183 tests passing (163 existing + 20 new persistence tests)
- All existing tests continue to pass (no regressions)
- All acceptance criteria met:
  - [x] SQLite WAL mode enabled (`PRAGMA journal_mode=WAL`)
  - [x] Synchronous set to NORMAL (`PRAGMA synchronous=NORMAL`)
  - [x] Foreign keys enforced (`PRAGMA foreign_keys=ON`)
  - [x] All write operations are wrapped in transactions where appropriate
  - [x] Server graceful shutdown closes DB connection properly
  - [x] No in-memory caching of mutable data — reads always hit SQLite
  - [x] Test: create a todo, close the process, restart, verify todo persists

**Design decisions:**
- Group and todo creation were the only write operations not using transactions. While SQLite's default autocommit makes each individual statement atomic, the read-max-position-then-insert pattern is a classic read-then-write race condition. Wrapping in a transaction ensures the position value is consistent even under concurrent access.
- Single-statement writes (e.g., `PATCH /api/todos/:id`, `PATCH /api/groups/:id`) do not need explicit transactions since SQLite auto-wraps them in implicit transactions.
- The persistence test suite uses real file-based SQLite databases (not in-memory) to accurately test crash recovery and close/reopen scenarios. Each test uses unique temp file paths to avoid interference.
- The end-to-end API persistence test creates data through the Hono app's HTTP layer, then verifies persistence by directly querying a fresh SQLite connection — proving the full stack persists to disk.

### Feature 7: Batch Operations API
**Status:** Complete
**Date:** 2026-02-17

**What was implemented:**
- Created Batch Operations routes at `src/routes/batch.ts` with all 3 endpoints:
  - `POST /api/todos/batch/complete` — Mark multiple todos as completed in a single transaction
  - `POST /api/todos/batch/delete` — Soft-delete multiple todos in a single transaction
  - `POST /api/todos/batch/move` — Move multiple todos to another group in a single transaction
- All endpoints accept `{ ids: string[] }` (move additionally requires `{ targetGroupId: string }`)
- All operations run in SQLite transactions for atomicity (consistent with Feature 6 patterns)
- Returns count of affected items plus array of skipped IDs: `{ data: { affected: number, skipped: string[] } }`
- Invalid IDs (non-existent or already soft-deleted todos) are skipped with partial success
- Updated `src/app.ts` to mount batch router at `/api/todos/batch`
- All responses follow `{ data: ... }` or `{ error: string }` shape per spec

**Files created/changed:**
- `src/routes/batch.ts` — Batch Operations route handlers with 3 endpoints (new)
- `src/tests/batch.test.ts` — 32 tests covering all batch endpoints, validation, partial success, and transaction guarantees (new)
- `src/app.ts` — Updated to import and mount batch router at `/api/todos/batch`

**Test results:**
- 215 tests passing (183 existing + 32 new batch tests)
- All acceptance criteria met:
  - [x] Each endpoint accepts `{ ids: string[] }`
  - [x] Move additionally requires `{ ids: string[], targetGroupId: string }`
  - [x] All operations run in a single transaction
  - [x] Returns count of affected items
  - [x] Invalid IDs are skipped (partial success), with report of skipped IDs
  - [x] Tests for each batch operation (32 tests covering happy path, error cases, partial success, transactions)

**Design decisions:**
- Created a separate `batch.ts` router rather than adding to the existing `todos.ts` to keep concerns separated and avoid route conflicts with the `:id` parameter routes.
- Batch operations skip soft-deleted todos (treated as invalid) to prevent unintended operations on trashed items. This is consistent with how the regular API handles soft-deleted todos.
- Timestamps are set once at the start of each transaction, ensuring all affected todos get the same `updated_at` (and `deleted_at` for batch delete) value — this enables easy verification of atomic operations.
- Target group validation for batch move happens before the transaction starts, returning 404 early if the group doesn't exist, rather than partially succeeding.

### Feature 8: Search & Filter API
**Status:** Complete
**Date:** 2026-02-17

**What was implemented:**
- Created Search route at `src/routes/search.ts` with the `GET /api/search` endpoint:
  - Query Parameters:
    - `q` (required): search term — matches against title and description
    - `completed` (optional): `true`, `false`, or `all` — filter by completion status
    - `group_id` (optional): filter results to a specific group
  - Returns search results with group context, sorted by relevance (title matches before description matches, then by updated_at descending)
- Case-insensitive search using SQLite's LIKE operator
- Soft-deleted todos are automatically excluded from search results
- Response shape includes query echo, count, and results array with full todo data plus group info:
  ```json
  {
    "data": {
      "query": "groceries",
      "count": 2,
      "results": [
        {
          "id": "uuid",
          "title": "Buy groceries",
          "description": "...",
          "is_completed": 0,
          "position": 0,
          "group": { "id": "uuid", "name": "Home" },
          "created_at": "...",
          "updated_at": "..."
        }
      ]
    }
  }
  ```
- Updated `src/app.ts` to mount search router at `/api/search`
- All responses follow `{ data: ... }` or `{ error: string }` shape per spec

**Files created/changed:**
- `src/routes/search.ts` — Search route handler with GET endpoint (new)
- `src/tests/search.test.ts` — 35 tests covering all search functionality (new)
- `src/app.ts` — Updated to import and mount search router at `/api/search`

**Test results:**
- 250 tests passing (215 existing + 35 new search tests)
- All acceptance criteria met:
  - [x] Search is case-insensitive
  - [x] Matches against title and description
  - [x] Results include the group name for context
  - [x] Empty query returns 400
  - [x] Results sorted by relevance (title match > description match)
  - [x] Tests for search behavior (35 tests covering basic search, case-insensitivity, filters, relevance sorting, edge cases)

**Design decisions:**
- Used SQLite's built-in LIKE operator with `%term%` pattern for full-text search. While FTS5 would be more efficient for large datasets, LIKE is simpler to implement and sufficient for a local-only personal todo app. The spec mentions FTS5 as optional.
- Relevance sorting is implemented in JavaScript after querying: title matches are prioritized over description-only matches, and within each category results are sorted by `updated_at` descending (most recent first).
- The `group_id` filter validates that the group exists before searching, returning 404 if not found. This provides clear feedback rather than silently returning empty results for invalid group IDs.
- The search term is trimmed before use, and whitespace-only queries return 400 (same as empty query).
- Soft-deleted todos are excluded via `isNull(todos.deleted_at)` in the WHERE clause, consistent with how other list endpoints handle soft-deletes.

---

## In Progress

(None)

---

## Handoff Notes

When a context limit is reached, the agent will document its progress here for the next iteration to continue.

**All features complete!** The Nodes To-Do API (Phase 1) is fully implemented with 250 tests passing.

---

## Session History

| Date | Iteration | Feature | Status | Notes |
|------|-----------|---------|--------|-------|
| 2025-02-16 | 1 | Feature 1: Project Scaffolding & Database Setup | Complete | 15 tests passing, all acceptance criteria met |
| 2026-02-16 | 2 | Feature 2: Groups CRUD API | Complete | 27 new tests (42 total), all acceptance criteria met |
| 2026-02-16 | 3 | Feature 3: Todos CRUD API | Complete | 45 new tests (87 total), all acceptance criteria met |
| 2026-02-16 | 4 | Feature 4: Trash & Auto-Purge System | Complete | 29 new tests (116 total), all acceptance criteria met |
| 2026-02-16 | 5 | Feature 5: Node Connections API | Complete | 47 new tests (163 total), all acceptance criteria met |
| 2026-02-17 | 6 | Feature 6: Auto-Save & Data Persistence Guarantees | Complete | 20 new tests (183 total), all acceptance criteria met |
| 2026-02-17 | 7 | Feature 7: Batch Operations API | Complete | 32 new tests (215 total), all acceptance criteria met |
| 2026-02-17 | 8 | Feature 8: Search & Filter API | Complete | 35 new tests (250 total), all acceptance criteria met |

---

## PROJECT COMPLETE

All 8 features have been implemented and tested. The Nodes To-Do API (Phase 1) is complete with:
- 250 tests passing
- Full CRUD for Groups, Todos, Connections
- Trash system with 30-day auto-purge
- Batch operations
- Full-text search with relevance sorting
- Data persistence guarantees with SQLite WAL mode
