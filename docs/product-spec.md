# Nodes To-Do Product Spec

## Core views

- `Groups`: primary buckets for work.
- `Agenda`: reminder-focused view split into overdue, today, upcoming, and no-reminder buckets.
- `Connections`: chain-like task groupings with explicit meaning.
- `GraphPlan`: visual planning surface for connected tasks.
- `Search`: cross-group task search by title and notes.
- `Settings`: local preferences, debug stats, backup management, and recent activity.
- `Trash`: recoverable deleted tasks and groups.

## Tasks

- A task belongs to exactly one group.
- A task has:
  - `title`
  - `description` used as notes
  - `high_priority`
  - `reminder_at`
  - optional recurring reminder rule (`daily`, `weekly`, `monthly`)
  - `planning_level`
  - optional `parent_todo_id`
  - completion state
  - persisted ordering metadata
- Notes are optional and are surfaced in list, search, and agenda contexts.
- Notes support lightweight structure:
  - multiline preview
  - expand/collapse for long notes
  - auto-linked URLs
  - checklist-style lines using `- [ ]` and `- [x]`

## Connections

- A connection links 2 to 7 tasks, except `branch`, which is capped at 3 tasks (`1 root + 2 branches`).
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
- Connection progress now reports:
  - `completed`
  - `available_count`
  - `blocked_count`
  - `next_available_item_id`

## Planning and reminders

- Planning levels (`0` to `5`) can be assigned to tasks.
- Tasks can optionally point to a parent task within the same group.
- Reminder acknowledgement supports recurring reminders by advancing the reminder instead of clearing it.
- Agenda and search surface reminder and planning information.

## Search and diagnostics

- Search supports filters for:
  - completion status
  - group
  - high priority
  - reminder presence
  - connection kind
  - planning level
  - sort mode
- Settings exposes lightweight debug stats for groups, tasks, reminders, recurrence, planning levels, and connections.
- Activity feed records important task, connection, and backup changes.
- Local JSON backup snapshots support create, list, restore, and delete.

## Keyboard shortcuts

- `/` opens Search and focuses the input.
- `N` opens the add-task form in task view.
- `T` opens tasks.
- `C` opens Connections.
- `G` opens GraphPlan.
- `R` opens Agenda.
- `S` opens Settings.
- `F` toggles GraphPlan fullscreen.
- `?` opens the shortcut reference.
