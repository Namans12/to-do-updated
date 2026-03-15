# Nodes To-Do Product Spec

## Core views

- `Groups`: primary buckets for work.
- `Agenda`: reminder-focused view with both bucketed agenda and roadmap timeline modes.
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
  - quick insert helpers for headings, links, and checklists while editing
- Parent and subtask relationships are surfaced directly in the task list and roadmap.

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
- Connection meaning:
  - `sequence`: a step-by-step chain
  - `branch`: a split or fork in work
  - `dependency`: one step unlocks another
  - `related`: connected, but not strictly ordered
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
- Roadmap mode groups tasks by reminder date and planning depth so project flow is easier to scan.

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
- Manual sync packages support multi-device export and import without a hosted sync server.

## GraphPlan

- GraphPlan supports:
  - direct edge selection
  - in-graph connection renaming
  - connection meaning edits
  - delete from the graph inspector
  - layout re-application without losing existing rules
- Available auto-layout presets:
  - `smart`
  - `horizontal`
  - `vertical`
  - `radial`
  - `planning`

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
