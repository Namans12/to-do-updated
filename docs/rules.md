# Ordering And Connection Rules

## Group ordering

- High priority items always render above normal items.
- Default order inside each priority band is oldest-first.
- Manual reorder overrides default order and persists.
- Group reorder is allowed only within the same priority band.
- Completed tasks are shown separately from incomplete tasks.

## Connection placement

- A normal connection appears where its first task belongs in the group order.
- If any task inside a connection is high priority, the whole connection is treated as high priority.
- High-priority connections are ordered by the earliest-created high-priority task inside them.
- When a solo task becomes part of a connection, the connection placement is recalculated fresh.

## Connection membership

- A task can belong to only one connection total.
- `sequence`, `dependency`, and `related` connections support 2 to 7 tasks.
- `branch` connections support at most 3 tasks:
  - item 1 is the root
  - items 2 and 3 are the branch children
- Reordering inside a connection is fully free and persists.

## Connection kind behavior

- `sequence`
  - A step-by-step chain.
  - The next incomplete item is highlighted as the next step.
- `dependency`
  - One step unlocks another.
  - Only the first incomplete item is available.
  - All later incomplete items are counted as blocked.
  - Completing a blocked dependency task is rejected until its predecessors are done.
- `branch`
  - A split or fork in work.
  - First item is the root.
  - Children are blocked until the root is complete.
  - Once the root is done, incomplete children are all available.
- `related`
  - Connected, but not strictly ordered.
  - All incomplete items remain available.

## GraphPlan rules

- GraphPlan models chain-like adjacency, not multi-branch node meshes.
- A node can have at most 2 connected neighbors.
- Branch graphs are rendered as one root node with up to 2 child nodes, which keeps the max-neighbor rule intact.
- The canvas has a hard max size and prevents dragging beyond the limit.
- Boundary guidance appears during drag near the right and bottom limits.
- New or unpositioned nodes use a smarter default layout:
  - sequence connections lay out horizontally
  - dependency connections lay out vertically
  - branch connections fan out from the root
  - related connections cluster together
  - planning levels influence left-to-right placement
- GraphPlan also supports manual re-application of these presets:
  - smart
  - horizontal
  - vertical
  - radial
  - planning
- Selecting an edge in GraphPlan opens a connection inspector for renaming, meaning changes, deletion, and layout actions.

## Notes and planning rules

- Notes are stored in the task description field.
- Long notes collapse by default and can be expanded inline.
- URLs in notes render as links.
- Checklist-style lines render visually when written as `- [ ]` or `- [x]`.
- The note editor provides quick insert helpers for headings, links, and checklist lines.
- Planning levels range from `0` to `5`.
- A parent task, when set, must exist in the same group and cannot point to the task itself.
- Parent tasks render above subtasks in the group list when both are solo tasks.

## Reminder rules

- Recurring reminders require a base reminder date/time.
- Supported reminder recurrences are:
  - daily
  - weekly
  - monthly
- Acknowledging a recurring reminder advances it to the next occurrence instead of clearing it.
