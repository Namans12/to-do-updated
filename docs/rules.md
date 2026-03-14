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
- Connections support 2 to 7 tasks.
- Reordering inside a connection is fully free and persists.

## GraphPlan rules

- GraphPlan models chain-like adjacency, not multi-branch node meshes.
- A node can have at most 2 connected neighbors.
- The canvas has a hard max size and prevents dragging beyond the limit.
- Boundary guidance appears during drag near the right and bottom limits.
