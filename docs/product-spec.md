# Nodes To-Do Product Spec

## Core views

- `Groups`: primary buckets for work.
- `Agenda`: reminder-focused view split into overdue, today, upcoming, and no-reminder buckets.
- `Connections`: chain-like task groupings with explicit meaning.
- `GraphPlan`: visual planning surface for connected tasks.
- `Search`: cross-group task search by title and notes.
- `Trash`: recoverable deleted tasks and groups.

## Tasks

- A task belongs to exactly one group.
- A task has:
  - `title`
  - `description` used as notes
  - `high_priority`
  - `reminder_at`
  - completion state
  - persisted ordering metadata
- Notes are optional and are surfaced in list, search, and agenda contexts.

## Connections

- A connection links 2 to 7 tasks.
- A task can belong to only one connection.
- A connection has:
  - optional `name`
  - `kind`
  - ordered items
  - progress
- Supported `kind` values:
  - `sequence`
  - `dependency`
  - `branch`
  - `related`

## Keyboard shortcuts

- `/` opens Search and focuses the input.
- `N` opens the add-task form in task view.
- `T` opens tasks.
- `C` opens Connections.
- `G` opens GraphPlan.
- `R` opens Agenda.
- `F` toggles GraphPlan fullscreen.
- `?` opens the shortcut reference.
