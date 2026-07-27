# Nodes To-Do — Updated (Dupe of [nodes-todo](https://github.com/Namans12/nodes-todo))

Second generation of **[`nodes-todo`](https://github.com/Namans12/nodes-todo)**, copied 2026-02-27. Adds live sync, backups, recurring tasks, templates, and activity history to the offline node-graph to-do app.

> ### Position in the chain
>
> `nodes-todo` → **`to-do-updated`** → [`to-do-better`](https://github.com/Namans12/to-do-better)
>
> This is the middle generation. `to-do-better` contains 100% of this repo's files plus native wrappers and Supabase auth. **Unless you specifically want this intermediate state, start from [`to-do-better`](https://github.com/Namans12/to-do-better).**

> ### The default branch is behind
>
> `master` stops at 2026-03-16. Five branches sit unmerged on top, ending at **`new9_final`** (2026-03-24, +7 commits).
>
> ```bash
> git checkout new9_final
> ```

## What this repo is

Same product as the original — an offline, local-only to-do app whose tasks link to each other as nodes in a graph. For the data model, API surface, and how to run it, see the **[canonical README in `nodes-todo`](https://github.com/Namans12/nodes-todo#readme)**.

This README covers what changed.

## How it differs from `nodes-todo`

54 files there, 94 here. 42 added, 36 modified, 2 removed.

### New backend routes

| File | Purpose |
|---|---|
| `app/src/routes/sync.ts` | Live sync endpoint — the app is no longer strictly single-device |
| `app/src/routes/backups.ts` | Create, list, and restore local backups |
| `app/src/routes/templates.ts` | Reusable to-do templates |
| `app/src/routes/activity.ts` | Activity/history feed |
| `app/src/lib/recurrence.ts` | Recurring-task scheduling |
| `app/src/lib/activity.ts` | Activity-log helpers |

With matching suites in `app/src/tests/` — `sync.test.ts` and `activity-backups.test.ts`.

### Frontend rewrites

The graph view was largely rebuilt — it is the single biggest change in this generation:

| File | original | here | Δ |
|---|---|---|---|
| `frontend/src/components/GraphView.tsx` | 928 | 2784 | **+1856** |
| `app/src/routes/connections.ts` | 570 | 1228 | +658 |
| `frontend/src/context/AppContext.tsx` | 313 | 905 | +592 |
| `frontend/src/components/TodoList.tsx` | 386 | 866 | +480 |
| `app/src/routes/todos.ts` | 424 | 893 | +469 |
| `frontend/src/components/TodoItem.tsx` | 414 | 759 | +345 |
| `app/src/tests/todos.test.ts` | 786 | 1049 | +263 |

A `frontend/src/sync/` directory and PWA support (`pwa.d.ts`) also arrive here.

### Removed

`app/DEVELOPMENT-LOG.md` and `app/SPEC.md` were dropped. **The specification survives only in [`nodes-todo`](https://github.com/Namans12/nodes-todo/blob/master/app/SPEC.md)** — worth reading from there, since it still describes this data model accurately.

## Branches

Linear chain; each contains everything before it.

| Branch | Date | Ahead | What it adds |
|---|---|---|---|
| `master` *(default)* | 2026-03-16 | — | Supabase groundwork, mobile tab, lag-free graph rendering |
| `new5` | 2026-03-17 | +2 | Large import of sync and backup work — 129 files, ~13k lines |
| `new6` | 2026-03-19 | +3 | Bug fixes across 21 files |
| `new7` | 2026-03-21 | +5 | Broad pass over 26 files, ~1.2k lines |
| `new8_better` | 2026-03-24 | +6 | UI-focused fixes across 17 files |
| `new9_final` | 2026-03-24 | +7 | **Branching support** — 14 files, ~1.1k lines. Head of this repo |

## Getting started

```bash
git clone https://github.com/Namans12/to-do-updated.git
cd to-do-updated
git checkout new9_final

cd app && npm install && npm run db:migrate && npm run dev
```

Then in a second terminal:

```bash
cd frontend && npm install && npm run dev
```

Scripts and API routes are otherwise unchanged from the original — see the [canonical README](https://github.com/Namans12/nodes-todo#readme).

## Which repo should you use?

| You want | Use |
|---|---|
| The clean offline-only original | [`nodes-todo`](https://github.com/Namans12/nodes-todo) |
| Sync, backups, templates, recurrence — without native wrappers | **this repo**, on `new9_final` |
| Everything, including auth and mobile builds | [`to-do-better`](https://github.com/Namans12/to-do-better) |
| Just the API | [`nodes-todo-backend`](https://github.com/Namans12/nodes-todo-backend) |
