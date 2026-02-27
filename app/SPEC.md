# Project Specification — Nodes To-Do

A standalone, offline, local-only To-Do list application with group management, node-based task connections, and secure access. Built server-first with a Hono TypeScript REST API and SQLite database.

---

## Project Overview

**Nodes To-Do** is a personal productivity app that runs entirely on the local machine with zero cloud dependency. It organizes to-dos into user-created groups (e.g., "Office", "Home"), supports rich descriptions, and introduces a unique **node-connection system** where related to-dos can be linked as parts of a larger task — completing sub-tasks visually shrinks the connection graph and shows a progress indicator, and completing all connected items crosses off the parent.

All data lives in a local SQLite database. Deleted items enter a soft-delete trash with automatic 30-day purge. No data persists in cache or temp files after purge.

**Current Phase:** Server / API + Database (Phase 1)
**Future Phases:** Authentication (Phase 2), Frontend & Desktop Shell (Phase 3)

---

## Technical Requirements

- **Runtime:** Node.js (latest LTS)
- **Language:** TypeScript (strict mode)
- **Server Framework:** Hono
- **Database:** SQLite (via better-sqlite3)
- **ORM/Query:** Drizzle ORM
- **Port:** 8080
- **Testing:** Vitest
- **Build:** tsup or tsc
- **Package Manager:** npm

---

## Database Schema

### `groups`
| Column       | Type    | Notes                              |
|--------------|---------|------------------------------------|
| id           | TEXT    | UUID, primary key                  |
| name         | TEXT    | Group name, required, unique       |
| position     | INTEGER | Sort order within the group list   |
| created_at   | TEXT    | ISO 8601 timestamp                 |
| updated_at   | TEXT    | ISO 8601 timestamp                 |

### `todos`
| Column        | Type    | Notes                                               |
|---------------|---------|-----------------------------------------------------|
| id            | TEXT    | UUID, primary key                                   |
| group_id      | TEXT    | FK → groups.id, required                            |
| title         | TEXT    | Auto-capitalized first letter on write               |
| description   | TEXT    | Optional, nullable                                  |
| is_completed  | INTEGER | 0 or 1                                              |
| position      | INTEGER | Sort order within the group                         |
| deleted_at    | TEXT    | Nullable; non-null = soft deleted (ISO 8601)        |
| created_at    | TEXT    | ISO 8601 timestamp                                  |
| updated_at    | TEXT    | ISO 8601 timestamp                                  |

### `connections`
| Column        | Type    | Notes                                                                   |
|---------------|---------|-------------------------------------------------------------------------|
| id            | TEXT    | UUID, primary key                                                       |
| name          | TEXT    | Optional label for the connection group                                 |
| created_at    | TEXT    | ISO 8601 timestamp                                                      |

### `connection_items`
| Column         | Type    | Notes                                               |
|----------------|---------|-----------------------------------------------------|
| id             | TEXT    | UUID, primary key                                   |
| connection_id  | TEXT    | FK → connections.id                                 |
| todo_id        | TEXT    | FK → todos.id                                       |
| position       | INTEGER | Order within the connection chain                   |

---

## Features to Implement

Features are ordered by dependency and priority. The Ralph loop picks ONE per iteration.

---

### Feature 1: Project Scaffolding & Database Setup
**Priority:** Critical
**Status:** Not Started

**Description:**
Initialize the project with TypeScript, Hono, better-sqlite3, Drizzle ORM, and Vitest. Set up the database schema with migrations. Create the SQLite database file in a local data directory (`./data/todos.db`).

**Acceptance Criteria:**
- [ ] `package.json` with all dependencies
- [ ] `tsconfig.json` with strict mode
- [ ] Drizzle schema files matching the schema above
- [ ] Migration script that creates all 4 tables
- [ ] Vitest config present
- [ ] `npm run dev` starts the Hono server on port 8080
- [ ] Server responds to `GET /health` with `{ status: "ok" }`
- [ ] At least 1 test verifying health endpoint

**Technical Notes:**
- Use `better-sqlite3` (synchronous, fast, no native build issues on Windows)
- Database file stored at `./data/todos.db` (auto-created if missing)
- Use `drizzle-orm` with `drizzle-orm/better-sqlite3`
- Use `drizzle-kit` for migrations

---

### Feature 2: Groups CRUD API
**Priority:** High
**Status:** Not Started

**Description:**
REST endpoints to create, read, update, delete, and reorder groups.

**Endpoints:**
| Method | Path                  | Description              |
|--------|-----------------------|--------------------------|
| POST   | `/api/groups`         | Create a group           |
| GET    | `/api/groups`         | List all groups (sorted) |
| GET    | `/api/groups/:id`     | Get a single group       |
| PATCH  | `/api/groups/:id`     | Update group name        |
| DELETE | `/api/groups/:id`     | Delete group + its todos |
| PATCH  | `/api/groups/reorder` | Reorder groups           |

**Acceptance Criteria:**
- [ ] All 6 endpoints return correct status codes and JSON
- [ ] Creating a group auto-sets position to end of list
- [ ] Deleting a group cascades soft-delete to all its todos
- [ ] Reorder accepts an array of `{ id, position }` and updates in a transaction
- [ ] Validation: name required, non-empty, max 100 chars
- [ ] Tests for each endpoint (happy path + error cases)

**Technical Notes:**
- Return 404 for missing groups
- Return 400 for validation failures with descriptive message
- All responses follow `{ data: ... }` or `{ error: string }` shape

---

### Feature 3: Todos CRUD API
**Priority:** High
**Status:** Not Started

**Description:**
REST endpoints for creating, reading, updating, completing, and deleting to-do items within a group. Includes auto-capitalization of the first letter on create/update.

**Endpoints:**
| Method | Path                         | Description                       |
|--------|------------------------------|-----------------------------------|
| POST   | `/api/groups/:groupId/todos` | Create a to-do in a group         |
| GET    | `/api/groups/:groupId/todos` | List todos in a group (sorted)    |
| GET    | `/api/todos/:id`             | Get a single to-do                |
| PATCH  | `/api/todos/:id`             | Update title/description          |
| PATCH  | `/api/todos/:id/complete`    | Toggle completion status          |
| DELETE | `/api/todos/:id`             | Soft-delete (set `deleted_at`)    |
| PATCH  | `/api/todos/reorder`         | Reorder todos within a group      |

**Acceptance Criteria:**
- [ ] All endpoints return correct status codes and JSON
- [ ] Title is auto-capitalized (first character uppercased) on create and update
- [ ] Creating a to-do auto-sets position to end of group list
- [ ] Soft-deleted todos are excluded from list queries by default
- [ ] Completing a to-do sets `is_completed = 1` and updates `updated_at`
- [ ] Toggling completion back to 0 works correctly
- [ ] Validation: title required, non-empty, max 500 chars; group must exist
- [ ] Tests for each endpoint

**Technical Notes:**
- Auto-capitalize: `title.charAt(0).toUpperCase() + title.slice(1)`
- Soft delete: set `deleted_at` to current ISO timestamp, never hard-delete here
- Include `?include_deleted=true` query param to show soft-deleted items

---

### Feature 4: Trash & Auto-Purge System
**Priority:** High
**Status:** Not Started

**Description:**
Soft-deleted items are recoverable for 30 days. After 30 days they are permanently hard-deleted from the database. A purge routine runs on server start and periodically.

**Endpoints:**
| Method | Path                       | Description                          |
|--------|----------------------------|--------------------------------------|
| GET    | `/api/trash`               | List all soft-deleted todos          |
| POST   | `/api/trash/:id/restore`   | Restore a soft-deleted todo          |
| DELETE | `/api/trash/:id`           | Permanently delete immediately       |
| DELETE | `/api/trash`               | Empty entire trash permanently       |

**Acceptance Criteria:**
- [ ] Trash list shows all soft-deleted todos with remaining days until purge
- [ ] Restore clears `deleted_at` and returns the todo to its group
- [ ] Permanent delete removes the row from DB entirely
- [ ] Auto-purge runs on server startup and every 6 hours
- [ ] Auto-purge deletes rows where `deleted_at` is older than 30 days
- [ ] After permanent delete, no trace in DB, WAL, or cache
- [ ] Run `VACUUM` after bulk purge to reclaim space
- [ ] Tests for purge logic with mocked dates

**Technical Notes:**
- Use `setInterval` for periodic purge (every 6 hours = 21,600,000 ms)
- Purge query: `DELETE FROM todos WHERE deleted_at < datetime('now', '-30 days')`
- After purge, remove orphaned connection_items
- Run `PRAGMA wal_checkpoint(TRUNCATE)` then `VACUUM` after purge

---

### Feature 5: Node Connections API
**Priority:** High
**Status:** Not Started

**Description:**
Allow linking multiple to-dos into a "connection" — a chain of related tasks that form parts of a single larger objective. The API tracks completion progress across connected items.

**Endpoints:**
| Method | Path                                      | Description                          |
|--------|-------------------------------------------|--------------------------------------|
| POST   | `/api/connections`                        | Create a connection with todo IDs    |
| GET    | `/api/connections`                        | List all connections with progress   |
| GET    | `/api/connections/:id`                    | Get connection detail + items        |
| PATCH  | `/api/connections/:id`                    | Update connection name               |
| POST   | `/api/connections/:id/items`              | Add a todo to a connection           |
| DELETE | `/api/connections/:id/items/:todoId`      | Remove a todo from a connection      |
| DELETE | `/api/connections/:id`                    | Delete a connection (not the todos)  |

**Response shape for a connection:**
```json
{
  "id": "uuid",
  "name": "Grocery Run",
  "items": [
    { "id": "uuid", "todo_id": "uuid", "title": "Buy groceries", "is_completed": 1, "position": 0 },
    { "id": "uuid", "todo_id": "uuid", "title": "Cook dinner", "is_completed": 0, "position": 1 }
  ],
  "progress": {
    "total": 2,
    "completed": 1,
    "percentage": 50
  },
  "is_fully_complete": false
}
```

**Acceptance Criteria:**
- [ ] Create connection accepts `{ name?, todoIds: string[] }` with at least 2 items
- [ ] Progress is computed on read (completed / total × 100)
- [ ] `is_fully_complete` is true when all connected todos are completed
- [ ] A todo can belong to at most one connection
- [ ] Removing the last item from a connection auto-deletes the connection
- [ ] Deleting a connection does NOT delete the todos themselves
- [ ] Tests for progress calculation, CRUD, and edge cases

**Technical Notes:**
- Progress is derived at query time, not stored
- When a todo is soft-deleted, exclude it from progress (or mark it as completed)
- Uniqueness constraint: `todo_id` is unique in `connection_items`

---

### Feature 6: Auto-Save & Data Persistence Guarantees
**Priority:** Medium
**Status:** Not Started

**Description:**
Ensure all mutations are immediately persisted and the database is resilient to crashes. Configure SQLite pragmas for durability and performance.

**Acceptance Criteria:**
- [ ] SQLite WAL mode enabled (`PRAGMA journal_mode=WAL`)
- [ ] Synchronous set to NORMAL (`PRAGMA synchronous=NORMAL`)
- [ ] Foreign keys enforced (`PRAGMA foreign_keys=ON`)
- [ ] All write operations are wrapped in transactions where appropriate
- [ ] Server graceful shutdown closes DB connection properly
- [ ] No in-memory caching of mutable data — reads always hit SQLite
- [ ] Test: create a todo, kill the process, restart, verify todo persists

**Technical Notes:**
- These pragmas should be set at DB connection init time
- WAL mode gives concurrent reads + writes with crash safety
- `synchronous=NORMAL` is safe with WAL and faster than FULL

---

### Feature 7: Batch Operations API
**Priority:** Medium
**Status:** Not Started

**Description:**
Support batch operations for efficiency — bulk complete, bulk delete, bulk move between groups.

**Endpoints:**
| Method | Path                        | Description                           |
|--------|-----------------------------|---------------------------------------|
| POST   | `/api/todos/batch/complete` | Mark multiple todos as completed      |
| POST   | `/api/todos/batch/delete`   | Soft-delete multiple todos            |
| POST   | `/api/todos/batch/move`     | Move multiple todos to another group  |

**Acceptance Criteria:**
- [ ] Each endpoint accepts `{ ids: string[] }`
- [ ] Move additionally requires `{ ids: string[], targetGroupId: string }`
- [ ] All operations run in a single transaction
- [ ] Returns count of affected items
- [ ] Invalid IDs are skipped (partial success), with report of skipped IDs
- [ ] Tests for each batch operation

---

### Feature 8: Search & Filter API
**Priority:** Low
**Status:** Not Started

**Description:**
Full-text search across todo titles and descriptions, plus filtering by completion status.

**Endpoints:**
| Method | Path                | Description                         |
|--------|---------------------|-------------------------------------|
| GET    | `/api/search`       | Search todos by query string        |

**Query Parameters:** `q` (search term), `completed` (true/false/all), `group_id` (optional)

**Acceptance Criteria:**
- [ ] Search is case-insensitive
- [ ] Matches against title and description
- [ ] Results include the group name for context
- [ ] Empty query returns 400
- [ ] Results sorted by relevance (title match > description match)
- [ ] Tests for search behavior

**Technical Notes:**
- Use SQLite FTS5 for full-text search if possible, otherwise `LIKE '%term%'`
- Index `title` and `description` columns

---

## Completion Marker

When all features are implemented and tested, add "PROJECT COMPLETE" to DEVELOPMENT-LOG.md.

---

## Phase 3 — Frontend (React + Vite)

**Stack:** React 19, Vite, Tailwind CSS, Framer Motion, Lucide React, react-hot-toast

### Feature 9: Frontend Scaffolding & Core UI

**Priority:** Critical
**Status:** Complete

**Description:**
React SPA with sidebar group management, todo list view, trash view, connections view, search view, and dark/light theme toggle. Vite dev server proxies `/api` to backend on port 8080.

**Acceptance Criteria:**

- [x] Vite + React + Tailwind project in `frontend/` directory
- [x] Sidebar with group CRUD, navigation to Trash / Connections / Search views
- [x] Theme toggle (light/dark) with localStorage persistence
- [x] AppContext provides global state (groups, todos, connections, current view)
- [x] Responsive layout with mobile sidebar overlay

---

### Feature 10: Todo Creation with Enter / Shift+Enter

**Priority:** High
**Status:** Complete

**Description:**
When adding a new to-do, pressing **Enter** creates the todo immediately. Pressing **Shift+Enter** opens an inline description textarea below the title input; pressing **Enter** in the description field then creates the todo with both title and description. **Esc** cancels at any point.

**Acceptance Criteria:**

- [x] `Enter` in title input → creates todo (title only)
- [x] `Shift+Enter` in title input → reveals description textarea, focuses it
- [x] `Enter` in description textarea → creates todo with title + description
- [x] `Shift+Enter` in description textarea → allows multiline description
- [x] `Esc` anywhere → clears fields, hides the add form
- [x] Keyboard hint shown below input: Enter to add · Shift+Enter for description · Esc to cancel

---

### Feature 11: Todo Item Interactions

**Priority:** High
**Status:** Complete

**Description:**
Each todo item supports click-to-complete (with animation), inline edit, description expand/collapse, and soft-delete to trash. Edit mode also supports Enter to save and Shift+Enter to add/edit description.

**Acceptance Criteria:**

- [x] Checkbox with animated bounce on completion toggle
- [x] Strikethrough animation on completed items
- [x] Inline edit with title + description fields
- [x] Enter saves edit, Shift+Enter opens description field
- [x] Expand/collapse button for description preview
- [x] Delete button sends to trash with toast confirmation

---

### Feature 12: Connection Creation & Visualization

**Priority:** High
**Status:** Complete

**Description:**
Connections are created from the Connections view using a modal that allows multi-selecting todos from all groups, reordering them, and giving the connection an optional name. The connection view displays each connection as a card with progress bar, node chain visualization, step indicators, and a "NEXT" badge on the first incomplete task.

**Acceptance Criteria:**

- [x] Connection modal accessible from Connections view
- [x] Modal loads all todos from all groups for selection
- [x] Minimum 2 todos required to create a connection
- [x] Reorder with up/down arrows in selected list
- [x] Optional connection name input
- [x] Connection cards show progress bar with percentage
- [x] Node chain with connected dots and lines
- [x] "NEXT" badge with ⚡ icon on first incomplete step
- [x] Step indicators ("Step X of Y") on each node
- [x] Toggle todo completion directly from connection card
