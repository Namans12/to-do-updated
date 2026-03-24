import type {
  ActivityLog,
  BackupSnapshot,
  Connection,
  ConnectionKind,
  Group,
  RecurrenceRule,
  SyncPackage,
  TemplateSummary,
  Todo,
  TrashPayload,
  BackupTaskPreview,
} from "../types";
import { isSupabaseSyncEnabled } from "../sync/config";
import {
  syncedActivityApi,
  syncedConnectionsApi,
  syncedGroupsApi,
  syncedSearchApi,
  syncedTodosApi,
  syncedTrashApi,
} from "../sync/repository";

const BASE = "/api";

function ensureRestOnlyFeatureAvailable(featureName: string) {
  if (!isSupabaseSyncEnabled) return;
  throw new Error(`${featureName} is currently available only in local REST mode.`);
}

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

const restGroupsApi = {
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

const restTodosApi = {
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

const restTrashApi = {
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

const restConnectionsApi = {
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
  addItem: (connectionId: string, todoId: string, parentTodoId?: string | null) =>
    request<void>(`/connections/${connectionId}/items`, {
      method: "POST",
      body: JSON.stringify({ todoId, parentTodoId }),
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

export interface SearchResult {
  id: string;
  title: string;
  description: string | null;
  high_priority: number;
  is_completed: number;
  position: number;
  reminder_at: string | null;
  recurrence_rule: RecurrenceRule | null;
  connection_kind: ConnectionKind | null;
  group: { id: string; name: string };
  created_at: string;
  updated_at: string;
}

const restSearchApi = {
  search: async (
    q: string,
    filters?: {
      completed?: "all" | "true" | "false";
      groupId?: string;
      highPriority?: "all" | "true" | "false";
      hasReminder?: "all" | "true" | "false";
      connectionKind?: ConnectionKind | "all";
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
    if (filters?.sort && filters.sort !== "relevance") {
      params.set("sort", filters.sort);
    }
    const data = await request<{ query: string; count: number; results: SearchResult[] }>(`/search?${params}`);
    return data.results;
  },
};

const restActivityApi = {
  list: (limit = 50) => request<ActivityLog[]>(`/activity?limit=${limit}`),
  entityHistory: (entityType: string, entityId: string, limit = 100) =>
    request<ActivityLog[]>(`/activity/${entityType}/${entityId}?limit=${limit}`),
};

export const groupsApi = isSupabaseSyncEnabled ? syncedGroupsApi : restGroupsApi;
export const todosApi = isSupabaseSyncEnabled ? syncedTodosApi : restTodosApi;
export const connectionsApi = isSupabaseSyncEnabled ? syncedConnectionsApi : restConnectionsApi;
export const searchApi = isSupabaseSyncEnabled ? syncedSearchApi : restSearchApi;
export const trashApi = isSupabaseSyncEnabled ? syncedTrashApi : restTrashApi;
export const activityApi = isSupabaseSyncEnabled ? syncedActivityApi : restActivityApi;

export const backupsApi = {
  list: () => {
    ensureRestOnlyFeatureAvailable("Backups");
    return request<BackupSnapshot[]>("/backups");
  },
  create: (label?: string) => {
    ensureRestOnlyFeatureAvailable("Backups");
    return request<BackupSnapshot>("/backups", {
      method: "POST",
      body: JSON.stringify({ label }),
    });
  },
  restore: (id: string) => {
    ensureRestOnlyFeatureAvailable("Backups");
    return request<BackupSnapshot>(`/backups/${id}/restore`, {
      method: "POST",
    });
  },
  previewTask: (backupId: string, todoId: string) => {
    ensureRestOnlyFeatureAvailable("Backups");
    return request<BackupTaskPreview>(`/backups/${backupId}/todos/${todoId}`);
  },
  restoreTask: (backupId: string, todoId: string) => {
    ensureRestOnlyFeatureAvailable("Backups");
    return request<Todo>(`/backups/${backupId}/todos/${todoId}/restore`, {
      method: "POST",
    });
  },
  delete: (id: string) => {
    ensureRestOnlyFeatureAvailable("Backups");
    return request<void>(`/backups/${id}`, {
      method: "DELETE",
    });
  },
};

export const templatesApi = {
  list: () => {
    ensureRestOnlyFeatureAvailable("Templates");
    return request<TemplateSummary[]>("/templates");
  },
  create: (payload: { source_group_id: string; name?: string; description?: string | null }) => {
    ensureRestOnlyFeatureAvailable("Templates");
    return request<TemplateSummary>("/templates", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  apply: (id: string, groupId: string) => {
    ensureRestOnlyFeatureAvailable("Templates");
    return request<{
      group_id: string;
      template_id: string;
      created_todo_count: number;
      created_connection_count: number;
    }>(`/templates/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({ group_id: groupId }),
    });
  },
  delete: (id: string) => {
    ensureRestOnlyFeatureAvailable("Templates");
    return request<void>(`/templates/${id}`, {
      method: "DELETE",
    });
  },
};

export const syncApi = {
  exportPackage: (deviceName?: string) => {
    ensureRestOnlyFeatureAvailable("Manual sync package export/import");
    return request<SyncPackage>(
      `/sync/export${deviceName ? `?device_name=${encodeURIComponent(deviceName)}` : ""}`
    );
  },
  importPackage: (payload: SyncPackage) => {
    ensureRestOnlyFeatureAvailable("Manual sync package export/import");
    return request<{
      version: 1;
      exported_at: string;
      device_name: string | null;
      counts: {
        groups: number;
        todos: number;
        connections: number;
        connection_items: number;
        activity_logs: number;
      };
    }>("/sync/import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
