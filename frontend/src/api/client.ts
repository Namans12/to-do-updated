import type { Group, Todo, TrashItem, TrashPayload, Connection } from "../types";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json.data ?? json;
}

// ── Groups ──────────────────────────────────────────────
export const groupsApi = {
  list: () => request<Group[]>("/groups"),
  get: (id: string) => request<Group>(`/groups/${id}`),
  create: (name: string) =>
    request<Group>("/groups", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  update: (id: string, name: string) =>
    request<Group>(`/groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) =>
    request<void>(`/groups/${id}`, { method: "DELETE" }),
  reorder: (items: { id: string; position: number }[]) =>
    request<void>("/groups/reorder", {
      method: "PATCH",
      body: JSON.stringify({ items }),
    }),
};

// ── Todos ───────────────────────────────────────────────
export const todosApi = {
  list: (groupId: string) =>
    request<Todo[]>(`/groups/${groupId}/todos`),
  get: (id: string) => request<Todo>(`/todos/${id}`),
  create: (
    groupId: string,
    title: string,
    description?: string,
    options?: { high_priority?: boolean; reminder_at?: string | null }
  ) =>
    request<Todo>(`/groups/${groupId}/todos`, {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        high_priority: options?.high_priority,
        reminder_at: options?.reminder_at,
      }),
    }),
  update: (
    id: string,
    data: {
      title?: string;
      description?: string | null;
      high_priority?: boolean;
      reminder_at?: string | null;
    }
  ) =>
    request<Todo>(`/todos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  toggleComplete: (id: string) =>
    request<Todo>(`/todos/${id}/complete`, { method: "PATCH" }),
  delete: (id: string) =>
    request<void>(`/todos/${id}`, { method: "DELETE" }),
  reorder: (items: { id: string; position: number }[]) =>
    request<void>("/todos/reorder", {
      method: "PATCH",
      body: JSON.stringify({ items }),
    }),
};

// ── Batch ───────────────────────────────────────────────
export const batchApi = {
  complete: (ids: string[]) =>
    request<{ affected: number }>("/todos/batch/complete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  delete: (ids: string[]) =>
    request<{ affected: number }>("/todos/batch/delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  move: (ids: string[], targetGroupId: string) =>
    request<{ affected: number }>("/todos/batch/move", {
      method: "POST",
      body: JSON.stringify({ ids, targetGroupId }),
    }),
};

// ── Trash ───────────────────────────────────────────────
export const trashApi = {
  list: () => request<TrashPayload>("/trash"),
  restoreGroup: (groupId: string) =>
    request<{ message: string; restored_count: number }>(`/trash/groups/${groupId}/restore`, { method: "POST" }),
  deleteGroupPermanently: (groupId: string) =>
    request<{ message: string; deleted_todo_count: number }>(`/trash/groups/${groupId}`, { method: "DELETE" }),
  restore: (id: string) =>
    request<Todo>(`/trash/${id}/restore`, { method: "POST" }),
  deletePermanently: (id: string) =>
    request<void>(`/trash/${id}`, { method: "DELETE" }),
  empty: () => request<void>("/trash", { method: "DELETE" }),
};

// ── Connections ─────────────────────────────────────────
export const connectionsApi = {
  list: () => request<Connection[]>("/connections"),
  get: (id: string) => request<Connection>(`/connections/${id}`),
  create: (todoIds: string[], name?: string) =>
    request<Connection>("/connections", {
      method: "POST",
      body: JSON.stringify({ todoIds, name }),
    }),
  update: (id: string, name: string | null) =>
    request<Connection>(`/connections/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  addItem: (connectionId: string, todoId: string) =>
    request<void>(`/connections/${connectionId}/items`, {
      method: "POST",
      body: JSON.stringify({ todoId }),
    }),
  merge: (fromTodoId: string, toTodoId: string) =>
    request<Connection>("/connections/merge", {
      method: "POST",
      body: JSON.stringify({ fromTodoId, toTodoId }),
    }),
  cut: (connectionId: string, fromTodoId: string, toTodoId: string) =>
    request<{ left: Connection | null; right: Connection | null }>(
      `/connections/${connectionId}/cut`,
      {
        method: "POST",
        body: JSON.stringify({ fromTodoId, toTodoId }),
      }
    ),
  reorderItems: (connectionId: string, todoIds: string[]) =>
    request<Connection>(`/connections/${connectionId}/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ todoIds }),
    }),
  removeItem: (connectionId: string, todoId: string) =>
    request<void>(`/connections/${connectionId}/items/${todoId}`, {
      method: "DELETE",
    }),
  delete: (id: string) =>
    request<void>(`/connections/${id}`, { method: "DELETE" }),
};

// ── Search ──────────────────────────────────────────────
export const searchApi = {
  search: async (q: string, completed?: boolean, groupId?: string) => {
    const params = new URLSearchParams({ q });
    if (completed !== undefined) params.set("completed", String(completed));
    if (groupId) params.set("group_id", groupId);
    const data = await request<{ query: string; count: number; results: SearchResult[] }>(`/search?${params}`);
    return data.results;
  },
};

export interface SearchResult {
  id: string;
  title: string;
  description: string | null;
  high_priority: number;
  is_completed: number;
  position: number;
  group: { id: string; name: string };
  created_at: string;
  updated_at: string;
}
