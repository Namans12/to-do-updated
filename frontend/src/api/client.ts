import type {
  ActivityLog,
  BackupSnapshot,
  Connection,
  ConnectionKind,
  Group,
  RecurrenceRule,
  Todo,
  TrashPayload,
} from "../types";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  const text = await res.text();
  let json: any = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      return text as T;
    }
  }

  if (!res.ok) {
    throw new Error(json?.error || `Request failed: ${res.status}`);
  }

  if (!text) {
    return undefined as T;
  }

  return (json?.data ?? json) as T;
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
    options?: {
      high_priority?: boolean;
      reminder_at?: string | null;
      recurrence_rule?: RecurrenceRule | null;
      planning_level?: number;
      parent_todo_id?: string | null;
    }
  ) =>
    request<Todo>(`/groups/${groupId}/todos`, {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        high_priority: options?.high_priority,
        reminder_at: options?.reminder_at,
        recurrence_rule: options?.recurrence_rule,
        planning_level: options?.planning_level,
        parent_todo_id: options?.parent_todo_id,
      }),
    }),
  update: (
    id: string,
    data: {
      title?: string;
      description?: string | null;
      high_priority?: boolean;
      reminder_at?: string | null;
      recurrence_rule?: RecurrenceRule | null;
      planning_level?: number;
      parent_todo_id?: string | null;
    }
  ) =>
    request<Todo>(`/todos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  acknowledgeReminder: (id: string) =>
    request<Todo>(`/todos/${id}/reminder/ack`, { method: "POST" }),
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
  create: (todoIds: string[], name?: string, kind?: ConnectionKind) =>
    request<Connection>("/connections", {
      method: "POST",
      body: JSON.stringify({ todoIds, name, kind }),
    }),
  update: (id: string, data: { name?: string | null; kind?: ConnectionKind }) =>
    request<Connection>(`/connections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
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
  search: async (
    q: string,
    filters?: {
      completed?: "all" | "true" | "false";
      groupId?: string;
      highPriority?: "all" | "true" | "false";
      hasReminder?: "all" | "true" | "false";
      connectionKind?: ConnectionKind | "all";
      planningLevel?: number | "all";
      sort?: "relevance" | "created_oldest" | "created_newest" | "updated_oldest" | "updated_newest";
    }
  ) => {
    const params = new URLSearchParams({ q });
    if (filters?.completed && filters.completed !== "all") params.set("completed", filters.completed);
    if (filters?.groupId) params.set("group_id", filters.groupId);
    if (filters?.highPriority && filters.highPriority !== "all") {
      params.set("high_priority", filters.highPriority);
    }
    if (filters?.hasReminder && filters.hasReminder !== "all") {
      params.set("has_reminder", filters.hasReminder);
    }
    if (filters?.connectionKind && filters.connectionKind !== "all") {
      params.set("connection_kind", filters.connectionKind);
    }
    if (filters?.planningLevel !== undefined && filters.planningLevel !== "all") {
      params.set("planning_level", String(filters.planningLevel));
    }
    if (filters?.sort && filters.sort !== "relevance") {
      params.set("sort", filters.sort);
    }
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
  reminder_at: string | null;
  recurrence_rule: RecurrenceRule | null;
  planning_level: number;
  parent_todo_id: string | null;
  connection_kind: ConnectionKind | null;
  group: { id: string; name: string };
  created_at: string;
  updated_at: string;
}

export const activityApi = {
  list: (limit = 50) => request<ActivityLog[]>(`/activity?limit=${limit}`),
};

export const backupsApi = {
  list: () => request<BackupSnapshot[]>("/backups"),
  create: (label?: string) =>
    request<BackupSnapshot>("/backups", {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  restore: (id: string) =>
    request<BackupSnapshot>(`/backups/${id}/restore`, {
      method: "POST",
    }),
  delete: (id: string) =>
    request<void>(`/backups/${id}`, {
      method: "DELETE",
    }),
};
