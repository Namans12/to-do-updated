import type { Connection, Todo } from "../types";

export function compareByCreatedAtOldestFirst(
  a: { created_at: string },
  b: { created_at: string }
) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

export function compareTodosForGroupOrder(a: Todo, b: Todo) {
  if (a.high_priority !== b.high_priority) return b.high_priority - a.high_priority;
  if (a.position !== b.position) return a.position - b.position;
  return compareByCreatedAtOldestFirst(a, b);
}

export function isHighPriorityConnection(connection: Connection) {
  return connection.items.some((item) => item.high_priority === 1);
}
