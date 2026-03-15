import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import type {
  ActivityLog,
  Connection,
  ConnectionItem,
  ConnectionKind,
  Group,
  Todo,
  TrashGroup,
  TrashItem,
} from "../types";
import { isBrowserOnline } from "./config";
import {
  deletePendingOperation,
  readPendingOperations,
  readSyncSnapshot,
  writePendingOperation,
  writeSyncSnapshot,
  type PendingOperation,
  type SyncCacheSnapshot,
} from "./idb";
import { supabase } from "./supabase";

type GroupRow = Group & {
  user_id: string;
  deleted_at: string | null;
};

type TodoRow = Omit<Todo, "parent_todo_title"> & {
  user_id: string;
};

type ConnectionRow = {
  id: string;
  user_id: string;
  name: string | null;
  kind: ConnectionKind;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type ConnectionItemRow = {
  id: string;
  connection_id: string;
  todo_id: string;
  position: number;
  created_at: string;
};

type ActivityRow = {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  payload_json: string | null;
  created_at: string;
};

type SearchFilters = {
  completed?: "all" | "true" | "false";
  groupId?: string;
  highPriority?: "all" | "true" | "false";
  hasReminder?: "all" | "true" | "false";
  connectionKind?: ConnectionKind | "all";
  planningLevel?: number | "all";
  sort?: "relevance" | "created_oldest" | "created_newest" | "updated_oldest" | "updated_newest";
};

type SearchResult = {
  id: string;
  title: string;
  description: string | null;
  high_priority: number;
  is_completed: number;
  position: number;
  reminder_at: string | null;
  recurrence_rule: Todo["recurrence_rule"];
  planning_level: number;
  parent_todo_id: string | null;
  connection_kind: ConnectionKind | null;
  group: { id: string; name: string };
  created_at: string;
  updated_at: string;
};

type SnapshotDraft = SyncCacheSnapshot;

let memorySnapshot: SyncCacheSnapshot | null = null;
let activeSession: Session | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let flushPromise: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function parsePayload(payload_json: string | null) {
  if (!payload_json) return null;
  try {
    return JSON.parse(payload_json);
  } catch {
    return null;
  }
}

function normalizeActivity(row: ActivityRow): ActivityLog {
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    summary: row.summary,
    payload_json: row.payload_json,
    payload: parsePayload(row.payload_json),
    created_at: row.created_at,
  };
}

async function getSnapshot() {
  if (memorySnapshot) return memorySnapshot;
  memorySnapshot = await readSyncSnapshot();
  return memorySnapshot;
}

async function commitSnapshot(snapshot: SyncCacheSnapshot) {
  memorySnapshot = snapshot;
  await writeSyncSnapshot(snapshot);
}

async function mutateSnapshot(mutator: (draft: SnapshotDraft) => void) {
  const current = await getSnapshot();
  const next: SyncCacheSnapshot = {
    groups: [...current.groups],
    todos: [...current.todos],
    connections: [...current.connections],
    activity: [...current.activity],
    lastSyncedAt: current.lastSyncedAt,
  };
  mutator(next);
  await commitSnapshot(next);
  return next;
}

function buildConnectionProgress(kind: ConnectionKind, items: ConnectionItem[]) {
  const total = items.length;
  const completed = items.filter((item) => item.is_completed === 1).length;

  let blockedTitles: string[] = [];
  let availableCount = items.filter((item) => item.is_completed !== 1).length;
  let blockedCount = 0;
  let nextAvailableItemId: string | null = null;
  let nextUnlockTitle: string | null = null;
  let criticalPathLength = 0;

  if (kind === "related") {
    const next = items.find((item) => item.is_completed !== 1) ?? null;
    nextAvailableItemId = next?.todo_id ?? null;
    criticalPathLength = Math.max(0, total - completed);
  } else if (kind === "branch") {
    const root = items[0] ?? null;
    const children = items.slice(1);
    if (root && root.is_completed !== 1) {
      nextAvailableItemId = root.todo_id;
      availableCount = 1;
      blockedTitles = children
        .filter((item) => item.is_completed !== 1)
        .map((item) => item.title);
      blockedCount = blockedTitles.length;
      nextUnlockTitle = blockedTitles[0] ?? null;
    } else {
      const next = children.find((item) => item.is_completed !== 1) ?? null;
      nextAvailableItemId = next?.todo_id ?? null;
      blockedCount = 0;
      availableCount = children.filter((item) => item.is_completed !== 1).length;
      criticalPathLength = availableCount;
    }
  } else {
    const firstIncompleteIndex = items.findIndex((item) => item.is_completed !== 1);
    if (firstIncompleteIndex === -1) {
      availableCount = 0;
      blockedCount = 0;
    } else {
      const next = items[firstIncompleteIndex] ?? null;
      nextAvailableItemId = next?.todo_id ?? null;
      blockedTitles = items
        .slice(firstIncompleteIndex + 1)
        .filter((item) => item.is_completed !== 1)
        .map((item) => item.title);
      blockedCount = blockedTitles.length;
      availableCount = 1;
      nextUnlockTitle = blockedTitles[0] ?? null;
      criticalPathLength = items
        .slice(firstIncompleteIndex)
        .filter((item) => item.is_completed !== 1).length;
    }
  }

  return {
    total,
    completed,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    blocked_count: blockedCount,
    available_count: availableCount,
    next_available_item_id: nextAvailableItemId,
    blocked_titles: blockedTitles,
    next_unlock_title: nextUnlockTitle,
    critical_path_length: criticalPathLength,
  };
}

function buildConnections(
  connectionRows: ConnectionRow[],
  itemRows: ConnectionItemRow[],
  todos: Todo[]
): Connection[] {
  const todoById = new Map(todos.map((todo) => [todo.id, todo]));
  const groupedItems = new Map<string, ConnectionItem[]>();

  for (const item of itemRows) {
    const todo = todoById.get(item.todo_id);
    if (!todo || todo.deleted_at) continue;
    const mapped: ConnectionItem = {
      id: item.id,
      todo_id: item.todo_id,
      title: todo.title,
      is_completed: todo.is_completed,
      high_priority: todo.high_priority,
      completed_at: todo.completed_at,
      created_at: todo.created_at,
      position: item.position,
    };
    const existing = groupedItems.get(item.connection_id) ?? [];
    existing.push(mapped);
    groupedItems.set(item.connection_id, existing);
  }

  return connectionRows
    .filter((row) => !row.deleted_at)
    .map((row) => {
      const items = (groupedItems.get(row.id) ?? []).sort((a, b) => a.position - b.position);
      const progress = buildConnectionProgress(row.kind, items);
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        items,
        progress,
        is_fully_complete: items.length > 0 && items.every((item) => item.is_completed === 1),
        created_at: row.created_at,
      };
    })
    .filter((connection) => connection.items.length >= 2);
}

async function requireUserId() {
  if (!supabase) {
    throw new Error("Supabase sync is not configured.");
  }
  if (!activeSession?.user.id) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    activeSession = data.session;
  }
  const userId = activeSession?.user.id;
  if (!userId) throw new Error("Sign in to use live sync.");
  return userId;
}

async function fetchRemoteSnapshot() {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const userId = await requireUserId();

  const [groupsRes, todosRes, connectionsRes, itemsRes, activityRes] = await Promise.all([
    supabase.from("groups").select("*").eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("todos").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("connections").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("connection_items").select("*").order("position", { ascending: true }),
    supabase
      .from("activity_logs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (groupsRes.error) throw groupsRes.error;
  if (todosRes.error) throw todosRes.error;
  if (connectionsRes.error) throw connectionsRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (activityRes.error) throw activityRes.error;

  const groups = (groupsRes.data as GroupRow[])
    .filter((group) => !group.deleted_at)
    .map(({ deleted_at: _deletedAt, user_id: _userId, ...group }) => group);
  const todos = (todosRes.data as TodoRow[]).map(({ user_id: _userId, ...todo }) => todo);
  const connectionRows = connectionsRes.data as ConnectionRow[];
  const itemRows = itemsRes.data as ConnectionItemRow[];
  const connections = buildConnections(connectionRows, itemRows, todos);
  const activity = (activityRes.data as ActivityRow[]).map(normalizeActivity);

  const snapshot: SyncCacheSnapshot = {
    groups,
    todos,
    connections,
    activity,
    lastSyncedAt: nowIso(),
  };
  await commitSnapshot(snapshot);
  return snapshot;
}

async function maybeRefreshRemote() {
  const snapshot = await getSnapshot();
  if (!supabase || !activeSession || !isBrowserOnline()) {
    return snapshot;
  }
  if (!snapshot.lastSyncedAt) {
    return fetchRemoteSnapshot();
  }
  return snapshot;
}

export async function readSyncedSnapshot() {
  return maybeRefreshRemote();
}

function appendLocalActivity(
  snapshot: SyncCacheSnapshot,
  entry: {
    entityType: string;
    entityId: string;
    action: string;
    summary: string;
    payload?: unknown;
  }
) {
  snapshot.activity = [
    {
      id: crypto.randomUUID(),
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      summary: entry.summary,
      payload_json: entry.payload ? JSON.stringify(entry.payload) : null,
      payload: entry.payload ?? null,
      created_at: nowIso(),
    },
    ...snapshot.activity,
  ].slice(0, 200);
}

async function writeRemoteActivity(
  entityType: string,
  entityId: string,
  action: string,
  summary: string,
  payload?: unknown
) {
  if (!supabase) return;
  const userId = await requireUserId();
  const row: ActivityRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    summary,
    payload_json: payload ? JSON.stringify(payload) : null,
    created_at: nowIso(),
  };
  const { error } = await supabase.from("activity_logs").insert(row);
  if (error) throw error;
}

async function queueOperation(operation: Omit<PendingOperation, "id" | "createdAt">) {
  const queued: PendingOperation = {
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    ...operation,
  };
  await writePendingOperation(queued);
  return queued;
}

async function resolveConflictIfStale(
  table: "groups" | "todos" | "connections",
  id: string,
  baseUpdatedAt?: string
) {
  if (!supabase || !baseUpdatedAt) return false;
  const { data, error } = await supabase
    .from(table)
    .select("updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const remoteUpdatedAt = data?.updated_at as string | undefined;
  if (!remoteUpdatedAt) return false;
  if (remoteUpdatedAt > baseUpdatedAt) {
    await mutateSnapshot((snapshot) => {
      appendLocalActivity(snapshot, {
        entityType: "sync",
        entityId: id,
        action: "conflict_skipped",
        summary: `Skipped an offline ${table.slice(0, -1)} change because a newer remote version already exists.`,
        payload: { table, id, baseUpdatedAt, remoteUpdatedAt },
      });
    });
    return true;
  }
  return false;
}

async function withOfflineFallback<T>(
  operation: () => Promise<T>,
  fallback: () => Promise<T>
) {
  if (!isBrowserOnline()) {
    return fallback();
  }
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error && /network|fetch/i.test(error.message))
    ) {
      return fallback();
    }
    throw error;
  }
}

async function remoteGroupDelete(groupId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const timestamp = nowIso();
  const { error: groupError } = await supabase
    .from("groups")
    .update({ deleted_at: timestamp, updated_at: timestamp })
    .eq("id", groupId);
  if (groupError) throw groupError;
  const { error: todoError } = await supabase
    .from("todos")
    .update({ deleted_at: timestamp, updated_at: timestamp })
    .eq("group_id", groupId)
    .is("deleted_at", null);
  if (todoError) throw todoError;
}

async function findConnectionRowByTodoId(todoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data, error } = await supabase
    .from("connection_items")
    .select("connection_id")
    .eq("todo_id", todoId)
    .maybeSingle();
  if (error) throw error;
  return data?.connection_id as string | undefined;
}

async function remoteCleanupConnection(connectionId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data, error } = await supabase
    .from("connection_items")
    .select("*")
    .eq("connection_id", connectionId)
    .order("position", { ascending: true });
  if (error) throw error;
  const items = data as ConnectionItemRow[];
  if (items.length >= 2) return;
  await supabase.from("connection_items").delete().eq("connection_id", connectionId);
  await supabase
    .from("connections")
    .update({ deleted_at: nowIso(), updated_at: nowIso() })
    .eq("id", connectionId);
}

async function remoteRemoveTodoFromConnection(todoId: string) {
  const connectionId = await findConnectionRowByTodoId(todoId);
  if (!connectionId || !supabase) return;
  const { error } = await supabase.from("connection_items").delete().eq("todo_id", todoId);
  if (error) throw error;
  await remoteCleanupConnection(connectionId);
}

async function remoteBuildConnection(connectionId: string) {
  const snapshot = await fetchRemoteSnapshot();
  const connection = snapshot.connections.find((item) => item.id === connectionId);
  if (!connection) throw new Error("Connection not found.");
  return connection;
}

async function createGroupRemote(name: string, id: string = crypto.randomUUID()) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const userId = await requireUserId();
  const snapshot = await getSnapshot();
  const position = snapshot.groups.length;
  const timestamp = nowIso();
  const row: GroupRow = {
    id,
    user_id: userId,
    name,
    position,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const { error } = await supabase.from("groups").insert(row);
  if (error) throw error;
  await writeRemoteActivity("group", id, "created", `Created group "${name}".`, { name });
  return {
    id,
    name,
    position,
    created_at: timestamp,
    updated_at: timestamp,
  } satisfies Group;
}

async function updateGroupRemote(id: string, name: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const timestamp = nowIso();
  const { error } = await supabase
    .from("groups")
    .update({ name, updated_at: timestamp })
    .eq("id", id);
  if (error) throw error;
  await writeRemoteActivity("group", id, "updated", `Renamed group to "${name}".`, { name });
}

async function reorderGroupsRemote(items: Array<{ id: string; position: number }>) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  for (const item of items) {
    const { error } = await supabase
      .from("groups")
      .update({ position: item.position, updated_at: nowIso() })
      .eq("id", item.id);
    if (error) throw error;
  }
}

async function createTodoRemote(
  groupId: string,
  title: string,
  description?: string,
  options?: Record<string, unknown>,
  id: string = crypto.randomUUID()
) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const userId = await requireUserId();
  const snapshot = await getSnapshot();
  const groupTodos = snapshot.todos.filter((todo) => todo.group_id === groupId && !todo.deleted_at);
  const position = groupTodos.length;
  const timestamp = nowIso();
  const row: TodoRow = {
    id,
    user_id: userId,
    group_id: groupId,
    title,
    description: description ?? null,
    high_priority: options?.high_priority ? 1 : 0,
    reminder_at: (options?.reminder_at as string | null | undefined) ?? null,
    recurrence_rule: (options?.recurrence_rule as Todo["recurrence_rule"] | null | undefined) ?? null,
    recurrence_enabled: options?.recurrence_rule ? 1 : 0,
    next_occurrence_at: null,
    is_completed: 0,
    completed_at: null,
    position,
    parent_todo_id: (options?.parent_todo_id as string | null | undefined) ?? null,
    planning_level: Number(options?.planning_level ?? 0),
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const { error } = await supabase.from("todos").insert(row);
  if (error) throw error;
  await writeRemoteActivity("todo", id, "created", `Created task "${title}".`, { title, group_id: groupId });
  const { user_id: _userId, ...todo } = row;
  return todo;
}

async function updateTodoRemote(id: string, data: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const timestamp = nowIso();
  const patch: Record<string, unknown> = { ...data, updated_at: timestamp };
  if ("recurrence_rule" in patch) {
    patch.recurrence_enabled = patch.recurrence_rule ? 1 : 0;
  }
  const { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error) throw error;
  await writeRemoteActivity("todo", id, "updated", "Updated task details.", patch);
}

async function toggleTodoRemote(id: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data, error } = await supabase.from("todos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Task not found.");

  const todo = data as TodoRow;
  if (todo.is_completed !== 1) {
    const snapshot = await maybeRefreshRemote();
    const connection = snapshot.connections.find((item) =>
      item.items.some((connectionItem) => connectionItem.todo_id === id)
    );
    if (connection?.kind === "dependency") {
      const incompleteBefore = connection.items.find((item) => item.is_completed !== 1);
      if (incompleteBefore && incompleteBefore.todo_id !== id) {
        throw new Error("This dependency task is still blocked by an earlier step.");
      }
    }
  }

  const nextCompleted = todo.is_completed === 1 ? 0 : 1;
  const patch = {
    is_completed: nextCompleted,
    completed_at: nextCompleted ? nowIso() : null,
    updated_at: nowIso(),
  };
  const { error: updateError } = await supabase.from("todos").update(patch).eq("id", id);
  if (updateError) throw updateError;
  await writeRemoteActivity(
    "todo",
    id,
    nextCompleted ? "completed" : "reopened",
    nextCompleted ? `Completed "${todo.title}".` : `Reopened "${todo.title}".`,
    patch
  );
}

async function deleteTodoRemote(id: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  await remoteRemoveTodoFromConnection(id);
  const patch = { deleted_at: nowIso(), updated_at: nowIso() };
  const { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error) throw error;
  await writeRemoteActivity("todo", id, "deleted", "Moved task to trash.", patch);
}

async function reorderTodosRemote(items: Array<{ id: string; position: number }>) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  for (const item of items) {
    const { error } = await supabase
      .from("todos")
      .update({ position: item.position, updated_at: nowIso() })
      .eq("id", item.id);
    if (error) throw error;
  }
}

async function createConnectionRemote(
  todoIds: string[],
  name?: string,
  kind: ConnectionKind = "sequence",
  id: string = crypto.randomUUID()
) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const userId = await requireUserId();
  const existing = await Promise.all(todoIds.map((todoId) => findConnectionRowByTodoId(todoId)));
  if (existing.some(Boolean)) {
    throw new Error("A task can only belong to one connection.");
  }

  const timestamp = nowIso();
  const row: ConnectionRow = {
    id,
    user_id: userId,
    name: name ?? null,
    kind,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };
  const { error } = await supabase.from("connections").insert(row);
  if (error) throw error;
  const itemRows: ConnectionItemRow[] = todoIds.map((todoId, index) => ({
    id: crypto.randomUUID(),
    connection_id: id,
    todo_id: todoId,
    position: index,
    created_at: timestamp,
  }));
  const { error: itemError } = await supabase.from("connection_items").insert(itemRows);
  if (itemError) throw itemError;
  await writeRemoteActivity("connection", id, "created", `Created a ${kind} connection.`, {
    todoIds,
    name: name ?? null,
    kind,
  });
  return remoteBuildConnection(id);
}

async function updateConnectionRemote(id: string, data: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { error } = await supabase
    .from("connections")
    .update({ ...data, updated_at: nowIso() })
    .eq("id", id);
  if (error) throw error;
  await writeRemoteActivity("connection", id, "updated", "Updated connection details.", data);
}

async function addConnectionItemRemote(connectionId: string, todoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const existingConnectionId = await findConnectionRowByTodoId(todoId);
  if (existingConnectionId) {
    throw new Error("This task is already in another connection.");
  }
  const { data, error } = await supabase
    .from("connection_items")
    .select("position")
    .eq("connection_id", connectionId)
    .order("position", { ascending: false })
    .limit(1);
  if (error) throw error;
  const nextPosition = ((data?.[0]?.position as number | undefined) ?? -1) + 1;
  const { error: insertError } = await supabase.from("connection_items").insert({
    id: crypto.randomUUID(),
    connection_id: connectionId,
    todo_id: todoId,
    position: nextPosition,
    created_at: nowIso(),
  });
  if (insertError) throw insertError;
  await writeRemoteActivity("connection", connectionId, "item_added", "Added a task to the connection.", {
    todoId,
  });
}

async function mergeConnectionsRemote(fromTodoId: string, toTodoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const fromConnectionId = await findConnectionRowByTodoId(fromTodoId);
  const toConnectionId = await findConnectionRowByTodoId(toTodoId);
  if (!fromConnectionId || !toConnectionId) {
    throw new Error("Both tasks must already belong to a connection to merge them.");
  }
  if (fromConnectionId === toConnectionId) {
    return remoteBuildConnection(fromConnectionId);
  }

  const { data: sourceItems, error: sourceError } = await supabase
    .from("connection_items")
    .select("*")
    .eq("connection_id", fromConnectionId)
    .order("position", { ascending: true });
  if (sourceError) throw sourceError;
  const { data: targetItems, error: targetError } = await supabase
    .from("connection_items")
    .select("*")
    .eq("connection_id", toConnectionId)
    .order("position", { ascending: true });
  if (targetError) throw targetError;

  const allTodoIds = [
    ...(sourceItems as ConnectionItemRow[]).map((item) => item.todo_id),
    ...(targetItems as ConnectionItemRow[]).map((item) => item.todo_id),
  ];

  await supabase.from("connection_items").delete().eq("connection_id", fromConnectionId);
  await supabase.from("connection_items").delete().eq("connection_id", toConnectionId);
  await supabase
    .from("connections")
    .update({ deleted_at: nowIso(), updated_at: nowIso() })
    .eq("id", toConnectionId);

  const rows: ConnectionItemRow[] = allTodoIds.map((todoId, index) => ({
    id: crypto.randomUUID(),
    connection_id: fromConnectionId,
    todo_id: todoId,
    position: index,
    created_at: nowIso(),
  }));
  const { error: insertError } = await supabase.from("connection_items").insert(rows);
  if (insertError) throw insertError;
  await writeRemoteActivity("connection", fromConnectionId, "merged", "Merged two connections.", {
    fromTodoId,
    toTodoId,
  });
  return remoteBuildConnection(fromConnectionId);
}

async function cutConnectionRemote(connectionId: string, fromTodoId: string, toTodoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data, error } = await supabase
    .from("connection_items")
    .select("*")
    .eq("connection_id", connectionId)
    .order("position", { ascending: true });
  if (error) throw error;
  const items = data as ConnectionItemRow[];
  const firstIndex = items.findIndex((item) => item.todo_id === fromTodoId);
  const secondIndex = items.findIndex((item) => item.todo_id === toTodoId);
  if (firstIndex === -1 || secondIndex === -1 || Math.abs(firstIndex - secondIndex) !== 1) {
    throw new Error("Only adjacent items can be cut.");
  }
  const splitIndex = Math.max(firstIndex, secondIndex);
  const left = items.slice(0, splitIndex);
  const right = items.slice(splitIndex);

  await supabase.from("connection_items").delete().eq("connection_id", connectionId);
  if (left.length >= 2) {
    await supabase.from("connection_items").insert(
      left.map((item, index) => ({
        id: crypto.randomUUID(),
        connection_id: connectionId,
        todo_id: item.todo_id,
        position: index,
        created_at: nowIso(),
      }))
    );
  } else {
    await supabase
      .from("connections")
      .update({ deleted_at: nowIso(), updated_at: nowIso() })
      .eq("id", connectionId);
  }

  let rightConnection: Connection | null = null;
  if (right.length >= 2) {
    rightConnection = await createConnectionRemote(
      right.map((item) => item.todo_id),
      undefined,
      "sequence"
    );
  }
  await writeRemoteActivity("connection", connectionId, "cut", "Cut a connection into separate paths.", {
    fromTodoId,
    toTodoId,
  });
  return {
    left: left.length >= 2 ? await remoteBuildConnection(connectionId) : null,
    right: rightConnection,
  };
}

async function reorderConnectionItemsRemote(connectionId: string, todoIds: string[]) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data, error } = await supabase
    .from("connection_items")
    .select("*")
    .eq("connection_id", connectionId);
  if (error) throw error;
  const rows = data as ConnectionItemRow[];
  const rowByTodoId = new Map(rows.map((row) => [row.todo_id, row]));
  for (let index = 0; index < todoIds.length; index += 1) {
    const row = rowByTodoId.get(todoIds[index]!);
    if (!row) continue;
    const { error: updateError } = await supabase
      .from("connection_items")
      .update({ position: index })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }
}

async function removeConnectionItemRemote(connectionId: string, todoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { error } = await supabase
    .from("connection_items")
    .delete()
    .eq("connection_id", connectionId)
    .eq("todo_id", todoId);
  if (error) throw error;
  await remoteCleanupConnection(connectionId);
}

async function deleteConnectionRemote(id: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  await supabase.from("connection_items").delete().eq("connection_id", id);
  const { error } = await supabase
    .from("connections")
    .update({ deleted_at: nowIso(), updated_at: nowIso() })
    .eq("id", id);
  if (error) throw error;
  await writeRemoteActivity("connection", id, "deleted", "Deleted a connection.");
}

async function applyQueuedOperation(operation: PendingOperation) {
  switch (operation.kind) {
    case "group.create":
      await createGroupRemote(operation.payload.name as string, operation.payload.id as string);
      return;
    case "group.update":
      if (await resolveConflictIfStale("groups", operation.payload.id as string, operation.payload.baseUpdatedAt as string | undefined)) return;
      await updateGroupRemote(operation.payload.id as string, operation.payload.name as string);
      return;
    case "group.delete":
      await remoteGroupDelete(operation.payload.id as string);
      return;
    case "group.reorder":
      await reorderGroupsRemote(operation.payload.items as Array<{ id: string; position: number }>);
      return;
    case "todo.create":
      await createTodoRemote(
        operation.payload.groupId as string,
        operation.payload.title as string,
        operation.payload.description as string | undefined,
        operation.payload.options as Record<string, unknown> | undefined,
        operation.payload.id as string
      );
      return;
    case "todo.update":
      if (await resolveConflictIfStale("todos", operation.payload.id as string, operation.payload.baseUpdatedAt as string | undefined)) return;
      await updateTodoRemote(operation.payload.id as string, operation.payload.data as Record<string, unknown>);
      return;
    case "todo.toggleComplete":
      if (await resolveConflictIfStale("todos", operation.payload.id as string, operation.payload.baseUpdatedAt as string | undefined)) return;
      await toggleTodoRemote(operation.payload.id as string);
      return;
    case "todo.delete":
      await deleteTodoRemote(operation.payload.id as string);
      return;
    case "todo.reorder":
      await reorderTodosRemote(operation.payload.items as Array<{ id: string; position: number }>);
      return;
    case "todo.ackReminder":
      if (await resolveConflictIfStale("todos", operation.payload.id as string, operation.payload.baseUpdatedAt as string | undefined)) return;
      await updateTodoRemote(operation.payload.id as string, {
        reminder_at: null,
      });
      return;
    case "connection.create":
      await createConnectionRemote(
        operation.payload.todoIds as string[],
        operation.payload.name as string | undefined,
        operation.payload.kind as ConnectionKind | undefined,
        operation.payload.id as string
      );
      return;
    case "connection.update":
      if (await resolveConflictIfStale("connections", operation.payload.id as string, operation.payload.baseUpdatedAt as string | undefined)) return;
      await updateConnectionRemote(operation.payload.id as string, operation.payload.data as Record<string, unknown>);
      return;
    case "connection.addItem":
      await addConnectionItemRemote(operation.payload.connectionId as string, operation.payload.todoId as string);
      return;
    case "connection.merge":
      await mergeConnectionsRemote(operation.payload.fromTodoId as string, operation.payload.toTodoId as string);
      return;
    case "connection.cut":
      await cutConnectionRemote(
        operation.payload.connectionId as string,
        operation.payload.fromTodoId as string,
        operation.payload.toTodoId as string
      );
      return;
    case "connection.reorderItems":
      await reorderConnectionItemsRemote(operation.payload.connectionId as string, operation.payload.todoIds as string[]);
      return;
    case "connection.removeItem":
      await removeConnectionItemRemote(operation.payload.connectionId as string, operation.payload.todoId as string);
      return;
    case "connection.delete":
      await deleteConnectionRemote(operation.payload.id as string);
      return;
  }
}

export async function flushPendingOperations() {
  if (!supabase || !activeSession || !isBrowserOnline()) return;
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const operations = await readPendingOperations();
    for (const operation of operations.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      await applyQueuedOperation(operation);
      await deletePendingOperation(operation.id);
    }
    await fetchRemoteSnapshot();
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export function setSyncSession(session: Session | null) {
  activeSession = session;
}

export async function primeSyncState(session: Session | null) {
  activeSession = session;
  if (!session) {
    await commitSnapshot({
      groups: [],
      todos: [],
      connections: [],
      activity: [],
      lastSyncedAt: null,
    });
    return;
  }
  await withOfflineFallback(fetchRemoteSnapshot, getSnapshot);
  await flushPendingOperations();
}

export function subscribeToRealtime(onInvalidate: () => void) {
  if (!supabase || !activeSession) return () => {};
  realtimeChannel?.unsubscribe();
  realtimeChannel = supabase
    .channel(`nodes-sync-${activeSession.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, async () => {
      await fetchRemoteSnapshot();
      onInvalidate();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, async () => {
      await fetchRemoteSnapshot();
      onInvalidate();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "connections" }, async () => {
      await fetchRemoteSnapshot();
      onInvalidate();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "connection_items" }, async () => {
      await fetchRemoteSnapshot();
      onInvalidate();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, async () => {
      await fetchRemoteSnapshot();
      onInvalidate();
    });
  realtimeChannel.subscribe();

  const onOnline = () => {
    void flushPendingOperations();
    void fetchRemoteSnapshot().then(onInvalidate);
  };
  window.addEventListener("online", onOnline);

  return () => {
    realtimeChannel?.unsubscribe();
    realtimeChannel = null;
    window.removeEventListener("online", onOnline);
  };
}

function searchLocal(
  snapshot: SyncCacheSnapshot,
  query: string,
  filters?: SearchFilters
) {
  const lowered = query.toLowerCase();
  const groupById = new Map(snapshot.groups.map((group) => [group.id, group]));
  const connectionKindByTodoId = new Map<string, ConnectionKind>();
  for (const connection of snapshot.connections) {
    for (const item of connection.items) {
      connectionKindByTodoId.set(item.todo_id, connection.kind);
    }
  }

  let results = snapshot.todos
    .filter((todo) => !todo.deleted_at)
    .filter((todo) => `${todo.title} ${todo.description ?? ""}`.toLowerCase().includes(lowered))
    .filter((todo) =>
      filters?.completed && filters.completed !== "all"
        ? String(todo.is_completed === 1) === filters.completed
        : true
    )
    .filter((todo) => (filters?.groupId ? todo.group_id === filters.groupId : true))
    .filter((todo) =>
      filters?.highPriority && filters.highPriority !== "all"
        ? String(todo.high_priority === 1) === filters.highPriority
        : true
    )
    .filter((todo) =>
      filters?.hasReminder && filters.hasReminder !== "all"
        ? String(Boolean(todo.reminder_at)) === filters.hasReminder
        : true
    )
    .filter((todo) =>
      filters?.connectionKind && filters.connectionKind !== "all"
        ? connectionKindByTodoId.get(todo.id) === filters.connectionKind
        : true
    )
    .filter((todo) =>
      filters?.planningLevel !== undefined && filters.planningLevel !== "all"
        ? todo.planning_level === filters.planningLevel
        : true
    );

  const sort = filters?.sort ?? "relevance";
  if (sort === "created_oldest") {
    results = results.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } else if (sort === "created_newest") {
    results = results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else if (sort === "updated_oldest") {
    results = results.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  } else if (sort === "updated_newest") {
    results = results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } else {
    results = results.sort((a, b) => {
      const aTitle = a.title.toLowerCase().includes(lowered) ? 1 : 0;
      const bTitle = b.title.toLowerCase().includes(lowered) ? 1 : 0;
      if (aTitle !== bTitle) return bTitle - aTitle;
      return b.updated_at.localeCompare(a.updated_at);
    });
  }

  return results.map<SearchResult>((todo) => ({
    id: todo.id,
    title: todo.title,
    description: todo.description,
    high_priority: todo.high_priority,
    is_completed: todo.is_completed,
    position: todo.position,
    reminder_at: todo.reminder_at,
    recurrence_rule: todo.recurrence_rule,
    planning_level: todo.planning_level,
    parent_todo_id: todo.parent_todo_id,
    connection_kind: connectionKindByTodoId.get(todo.id) ?? null,
    group: {
      id: todo.group_id,
      name: groupById.get(todo.group_id)?.name ?? "Unknown group",
    },
    created_at: todo.created_at,
    updated_at: todo.updated_at,
  }));
}

function buildTrashPayload(snapshot: SyncCacheSnapshot) {
  const activeGroups = new Map(snapshot.groups.map((group) => [group.id, group]));
  const todos = snapshot.todos
    .filter((todo) => !!todo.deleted_at)
    .map<TrashItem>((todo) => {
      const deletedAt = todo.deleted_at ? new Date(todo.deleted_at) : new Date();
      const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const daysUntilPurge = Math.max(
        0,
        Math.ceil((purgeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      );
      return {
        ...todo,
        group_name: activeGroups.get(todo.group_id)?.name ?? "Deleted group",
        group_deleted: !activeGroups.has(todo.group_id),
        group_deleted_at: null,
        days_until_purge: daysUntilPurge,
      };
    });
  const groups: TrashGroup[] = [];
  return { todos, groups };
}

export const syncedGroupsApi = {
  list: async () => (await maybeRefreshRemote()).groups,
  get: async (id: string) => (await maybeRefreshRemote()).groups.find((group) => group.id === id) ?? null,
  create: async (name: string) =>
    withOfflineFallback(
      async () => {
        const group = await createGroupRemote(name);
        await fetchRemoteSnapshot();
        return group;
      },
      async () => {
        const group: Group = {
          id: crypto.randomUUID(),
          name,
          position: (await getSnapshot()).groups.length,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        await mutateSnapshot((snapshot) => {
          snapshot.groups.push(group);
          appendLocalActivity(snapshot, {
            entityType: "group",
            entityId: group.id,
            action: "queued_create",
            summary: `Queued creation of group "${name}" while offline.`,
          });
        });
        await queueOperation({
          kind: "group.create",
          payload: { id: group.id, name },
        });
        return group;
      }
    ),
  update: async (id: string, name: string) =>
    withOfflineFallback(
      async () => {
        await updateGroupRemote(id, name);
        await fetchRemoteSnapshot();
        return (await getSnapshot()).groups.find((group) => group.id === id)!;
      },
      async () => {
        const snapshot = await getSnapshot();
        const current = snapshot.groups.find((group) => group.id === id);
        if (!current) throw new Error("Group not found.");
        const updatedAt = nowIso();
        await mutateSnapshot((draft) => {
          draft.groups = draft.groups.map((group) =>
            group.id === id ? { ...group, name, updated_at: updatedAt } : group
          );
        });
        await queueOperation({
          kind: "group.update",
          payload: { id, name, baseUpdatedAt: current.updated_at },
        });
        return { ...current, name, updated_at: updatedAt };
      }
    ),
  delete: async (id: string) =>
    withOfflineFallback(
      async () => {
        await remoteGroupDelete(id);
        await fetchRemoteSnapshot();
      },
      async () => {
        const timestamp = nowIso();
        await mutateSnapshot((snapshot) => {
          snapshot.groups = snapshot.groups.filter((group) => group.id !== id);
          snapshot.todos = snapshot.todos.map((todo) =>
            todo.group_id === id ? { ...todo, deleted_at: timestamp, updated_at: timestamp } : todo
          );
        });
        await queueOperation({
          kind: "group.delete",
          payload: { id },
        });
      }
    ),
  reorder: async (items: { id: string; position: number }[]) =>
    withOfflineFallback(
      async () => {
        await reorderGroupsRemote(items);
        await fetchRemoteSnapshot();
      },
      async () => {
        await mutateSnapshot((snapshot) => {
          const positions = new Map(items.map((item) => [item.id, item.position]));
          snapshot.groups = snapshot.groups
            .map((group) => ({
              ...group,
              position: positions.get(group.id) ?? group.position,
              updated_at: nowIso(),
            }))
            .sort((a, b) => a.position - b.position);
        });
        await queueOperation({
          kind: "group.reorder",
          payload: { items },
        });
      }
    ),
};

export const syncedTodosApi = {
  list: async (groupId: string) => (await maybeRefreshRemote()).todos.filter((todo) => todo.group_id === groupId),
  get: async (id: string) => (await maybeRefreshRemote()).todos.find((todo) => todo.id === id) ?? null,
  create: async (
    groupId: string,
    title: string,
    description?: string,
    options?: Record<string, unknown>
  ) =>
    withOfflineFallback(
      async () => {
        const todo = await createTodoRemote(groupId, title, description, options);
        await fetchRemoteSnapshot();
        return todo;
      },
      async () => {
        const snapshot = await getSnapshot();
        const groupTodos = snapshot.todos.filter((todo) => todo.group_id === groupId && !todo.deleted_at);
        const todo: Todo = {
          id: crypto.randomUUID(),
          group_id: groupId,
          title,
          description: description ?? null,
          high_priority: options?.high_priority ? 1 : 0,
          reminder_at: (options?.reminder_at as string | null | undefined) ?? null,
          recurrence_rule: (options?.recurrence_rule as Todo["recurrence_rule"] | null | undefined) ?? null,
          recurrence_enabled: options?.recurrence_rule ? 1 : 0,
          next_occurrence_at: null,
          is_completed: 0,
          completed_at: null,
          position: groupTodos.length,
          parent_todo_id: (options?.parent_todo_id as string | null | undefined) ?? null,
          parent_todo_title: null,
          planning_level: Number(options?.planning_level ?? 0),
          deleted_at: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        await mutateSnapshot((draft) => {
          draft.todos.push(todo);
          appendLocalActivity(draft, {
            entityType: "todo",
            entityId: todo.id,
            action: "queued_create",
            summary: `Queued creation of "${title}" while offline.`,
          });
        });
        await queueOperation({
          kind: "todo.create",
          payload: { id: todo.id, groupId, title, description, options },
        });
        return todo;
      }
    ),
  update: async (id: string, data: Record<string, unknown>) =>
    withOfflineFallback(
      async () => {
        await updateTodoRemote(id, data);
        await fetchRemoteSnapshot();
        return (await getSnapshot()).todos.find((todo) => todo.id === id)!;
      },
      async () => {
        const snapshot = await getSnapshot();
        const current = snapshot.todos.find((todo) => todo.id === id);
        if (!current) throw new Error("Task not found.");
        const next: Todo = {
          ...current,
          ...data,
          recurrence_enabled:
            "recurrence_rule" in data
              ? data.recurrence_rule
                ? 1
                : 0
              : current.recurrence_enabled,
          updated_at: nowIso(),
        };
        await mutateSnapshot((draft) => {
          draft.todos = draft.todos.map((todo) => (todo.id === id ? next : todo));
        });
        await queueOperation({
          kind: "todo.update",
          payload: { id, data, baseUpdatedAt: current.updated_at },
        });
        return next;
      }
    ),
  acknowledgeReminder: async (id: string) => syncedTodosApi.update(id, { reminder_at: null }),
  toggleComplete: async (id: string) =>
    withOfflineFallback(
      async () => {
        await toggleTodoRemote(id);
        await fetchRemoteSnapshot();
        return (await getSnapshot()).todos.find((todo) => todo.id === id)!;
      },
      async () => {
        const snapshot = await getSnapshot();
        const current = snapshot.todos.find((todo) => todo.id === id);
        if (!current) throw new Error("Task not found.");
        const nextCompleted = current.is_completed === 1 ? 0 : 1;
        const next = {
          ...current,
          is_completed: nextCompleted,
          completed_at: nextCompleted ? nowIso() : null,
          updated_at: nowIso(),
        };
        await mutateSnapshot((draft) => {
          draft.todos = draft.todos.map((todo) => (todo.id === id ? next : todo));
        });
        await queueOperation({
          kind: "todo.toggleComplete",
          payload: { id, baseUpdatedAt: current.updated_at },
        });
        return next;
      }
    ),
  delete: async (id: string) =>
    withOfflineFallback(
      async () => {
        await deleteTodoRemote(id);
        await fetchRemoteSnapshot();
      },
      async () => {
        const timestamp = nowIso();
        await mutateSnapshot((draft) => {
          draft.todos = draft.todos.map((todo) =>
            todo.id === id ? { ...todo, deleted_at: timestamp, updated_at: timestamp } : todo
          );
          draft.connections = draft.connections
            .map((connection) => ({
              ...connection,
              items: connection.items.filter((item) => item.todo_id !== id),
            }))
            .filter((connection) => connection.items.length >= 2);
        });
        await queueOperation({
          kind: "todo.delete",
          payload: { id },
        });
      }
    ),
  reorder: async (items: { id: string; position: number }[]) =>
    withOfflineFallback(
      async () => {
        await reorderTodosRemote(items);
        await fetchRemoteSnapshot();
      },
      async () => {
        await mutateSnapshot((draft) => {
          const positions = new Map(items.map((item) => [item.id, item.position]));
          draft.todos = draft.todos.map((todo) =>
            positions.has(todo.id)
              ? { ...todo, position: positions.get(todo.id)!, updated_at: nowIso() }
              : todo
          );
        });
        await queueOperation({
          kind: "todo.reorder",
          payload: { items },
        });
      }
    ),
};

export const syncedConnectionsApi = {
  list: async () => (await maybeRefreshRemote()).connections,
  get: async (id: string) => (await maybeRefreshRemote()).connections.find((connection) => connection.id === id) ?? null,
  create: async (todoIds: string[], name?: string, kind?: ConnectionKind) =>
    withOfflineFallback(
      async () => {
        const connection = await createConnectionRemote(todoIds, name, kind);
        await fetchRemoteSnapshot();
        return connection;
      },
      async () => {
        const snapshot = await getSnapshot();
        const todoById = new Map(snapshot.todos.map((todo) => [todo.id, todo]));
        for (const todoId of todoIds) {
          if (snapshot.connections.some((connection) => connection.items.some((item) => item.todo_id === todoId))) {
            throw new Error("A task can only belong to one connection.");
          }
        }
        const connection: Connection = {
          id: crypto.randomUUID(),
          name: name ?? null,
          kind: kind ?? "sequence",
          items: todoIds.map((todoId, index) => {
            const todo = todoById.get(todoId);
            if (!todo) throw new Error("Task not found.");
            return {
              id: crypto.randomUUID(),
              todo_id: todo.id,
              title: todo.title,
              is_completed: todo.is_completed,
              high_priority: todo.high_priority,
              completed_at: todo.completed_at,
              created_at: todo.created_at,
              position: index,
            };
          }),
          progress: buildConnectionProgress(kind ?? "sequence", []),
          is_fully_complete: false,
          created_at: nowIso(),
        };
        connection.progress = buildConnectionProgress(connection.kind, connection.items);
        await mutateSnapshot((draft) => {
          draft.connections.push(connection);
        });
        await queueOperation({
          kind: "connection.create",
          payload: { id: connection.id, todoIds, name, kind },
        });
        return connection;
      }
    ),
  update: async (id: string, data: { name?: string | null; kind?: ConnectionKind }) =>
    withOfflineFallback(
      async () => {
        await updateConnectionRemote(id, data);
        await fetchRemoteSnapshot();
        return (await getSnapshot()).connections.find((connection) => connection.id === id)!;
      },
      async () => {
        const snapshot = await getSnapshot();
        const current = snapshot.connections.find((connection) => connection.id === id);
        if (!current) throw new Error("Connection not found.");
        const next: Connection = { ...current, ...data };
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.map((connection) =>
            connection.id === id ? next : connection
          );
        });
        await queueOperation({
          kind: "connection.update",
          payload: { id, data, baseUpdatedAt: current.created_at },
        });
        return next;
      }
    ),
  addItem: async (connectionId: string, todoId: string) =>
    withOfflineFallback(
      async () => {
        await addConnectionItemRemote(connectionId, todoId);
        await fetchRemoteSnapshot();
      },
      async () => {
        const snapshot = await getSnapshot();
        const todo = snapshot.todos.find((item) => item.id === todoId);
        if (!todo) throw new Error("Task not found.");
        if (snapshot.connections.some((connection) => connection.items.some((item) => item.todo_id === todoId))) {
          throw new Error("This task is already in another connection.");
        }
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.map((connection) => {
            if (connection.id !== connectionId) return connection;
            const items = [
              ...connection.items,
              {
                id: crypto.randomUUID(),
                todo_id: todoId,
                title: todo.title,
                is_completed: todo.is_completed,
                high_priority: todo.high_priority,
                completed_at: todo.completed_at,
                created_at: todo.created_at,
                position: connection.items.length,
              },
            ];
            return {
              ...connection,
              items,
              progress: buildConnectionProgress(connection.kind, items),
            };
          });
        });
        await queueOperation({
          kind: "connection.addItem",
          payload: { connectionId, todoId },
        });
      }
    ),
  merge: async (fromTodoId: string, toTodoId: string) =>
    withOfflineFallback(
      async () => {
        const connection = await mergeConnectionsRemote(fromTodoId, toTodoId);
        await fetchRemoteSnapshot();
        return connection;
      },
      async () => {
        const snapshot = await getSnapshot();
        const fromConnection = snapshot.connections.find((connection) =>
          connection.items.some((item) => item.todo_id === fromTodoId)
        );
        const toConnection = snapshot.connections.find((connection) =>
          connection.items.some((item) => item.todo_id === toTodoId)
        );
        if (!fromConnection || !toConnection) {
          throw new Error("Both tasks must already belong to a connection.");
        }
        if (fromConnection.id === toConnection.id) return fromConnection;
        const mergedItems = [...fromConnection.items, ...toConnection.items].map((item, index) => ({
          ...item,
          position: index,
        }));
        const merged = {
          ...fromConnection,
          items: mergedItems,
          progress: buildConnectionProgress(fromConnection.kind, mergedItems),
        };
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections
            .filter((connection) => connection.id !== toConnection.id)
            .map((connection) => (connection.id === fromConnection.id ? merged : connection));
        });
        await queueOperation({
          kind: "connection.merge",
          payload: { fromTodoId, toTodoId },
        });
        return merged;
      }
    ),
  cut: async (connectionId: string, fromTodoId: string, toTodoId: string) =>
    withOfflineFallback(
      async () => {
        const result = await cutConnectionRemote(connectionId, fromTodoId, toTodoId);
        await fetchRemoteSnapshot();
        return result;
      },
      async () => {
        throw new Error("Cut is only available while online in sync mode.");
      }
    ),
  reorderItems: async (connectionId: string, todoIds: string[]) =>
    withOfflineFallback(
      async () => {
        await reorderConnectionItemsRemote(connectionId, todoIds);
        await fetchRemoteSnapshot();
        return (await getSnapshot()).connections.find((connection) => connection.id === connectionId)!;
      },
      async () => {
        const snapshot = await getSnapshot();
        const connection = snapshot.connections.find((item) => item.id === connectionId);
        if (!connection) throw new Error("Connection not found.");
        const itemByTodoId = new Map(connection.items.map((item) => [item.todo_id, item]));
        const items = todoIds
          .map((todoId, index) => {
            const item = itemByTodoId.get(todoId);
            return item ? { ...item, position: index } : null;
          })
          .filter(Boolean) as ConnectionItem[];
        const next = {
          ...connection,
          items,
          progress: buildConnectionProgress(connection.kind, items),
        };
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.map((item) => (item.id === connectionId ? next : item));
        });
        await queueOperation({
          kind: "connection.reorderItems",
          payload: { connectionId, todoIds },
        });
        return next;
      }
    ),
  removeItem: async (connectionId: string, todoId: string) =>
    withOfflineFallback(
      async () => {
        await removeConnectionItemRemote(connectionId, todoId);
        await fetchRemoteSnapshot();
      },
      async () => {
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections
            .map((connection) => {
              if (connection.id !== connectionId) return connection;
              const items = connection.items
                .filter((item) => item.todo_id !== todoId)
                .map((item, index) => ({ ...item, position: index }));
              return {
                ...connection,
                items,
                progress: buildConnectionProgress(connection.kind, items),
              };
            })
            .filter((connection) => connection.items.length >= 2);
        });
        await queueOperation({
          kind: "connection.removeItem",
          payload: { connectionId, todoId },
        });
      }
    ),
  delete: async (id: string) =>
    withOfflineFallback(
      async () => {
        await deleteConnectionRemote(id);
        await fetchRemoteSnapshot();
      },
      async () => {
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.filter((connection) => connection.id !== id);
        });
        await queueOperation({
          kind: "connection.delete",
          payload: { id },
        });
      }
    ),
};

export const syncedSearchApi = {
  search: async (query: string, filters?: SearchFilters) => searchLocal(await maybeRefreshRemote(), query, filters),
};

export const syncedTrashApi = {
  list: async () => {
    const snapshot = await maybeRefreshRemote();
    if (!supabase) {
      return buildTrashPayload(snapshot);
    }
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, deleted_at")
      .eq("user_id", userId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw error;

    const deletedGroups = (data ?? []) as TrashGroup[];
    const deletedGroupById = new Map(deletedGroups.map((group) => [group.id, group]));
    const activeGroups = new Map(snapshot.groups.map((group) => [group.id, group]));

    const todos = snapshot.todos
      .filter((todo) => !!todo.deleted_at)
      .map<TrashItem>((todo) => {
        const deletedAt = todo.deleted_at ? new Date(todo.deleted_at) : new Date();
        const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        const daysUntilPurge = Math.max(
          0,
          Math.ceil((purgeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        );
        const deletedGroup = deletedGroupById.get(todo.group_id);
        return {
          ...todo,
          group_name: activeGroups.get(todo.group_id)?.name ?? deletedGroup?.name ?? "Deleted group",
          group_deleted: !!deletedGroup,
          group_deleted_at: deletedGroup?.deleted_at ?? null,
          days_until_purge: daysUntilPurge,
        };
      });

    return { todos, groups: deletedGroups };
  },
  restoreGroup: async (groupId: string) => {
    if (!supabase) throw new Error("Supabase sync is not configured.");
    const timestamp = nowIso();
    const groupRes = await supabase
      .from("groups")
      .update({ deleted_at: null, updated_at: timestamp })
      .eq("id", groupId);
    if (groupRes.error) throw groupRes.error;
    const todosRes = await supabase
      .from("todos")
      .update({ deleted_at: null, updated_at: timestamp })
      .eq("group_id", groupId);
    if (todosRes.error) throw todosRes.error;
    await fetchRemoteSnapshot();
    return { message: "Group restored", restored_count: 0 };
  },
  deleteGroupPermanently: async (groupId: string) => {
    if (!supabase) throw new Error("Supabase sync is not configured.");
    const { data: groupTodos, error: groupTodosError } = await supabase
      .from("todos")
      .select("id")
      .eq("group_id", groupId);
    if (groupTodosError) throw groupTodosError;
    for (const todo of groupTodos ?? []) {
      await remoteRemoveTodoFromConnection(todo.id as string);
    }
    const todosRes = await supabase.from("todos").delete().eq("group_id", groupId);
    if (todosRes.error) throw todosRes.error;
    const groupsRes = await supabase.from("groups").delete().eq("id", groupId);
    if (groupsRes.error) throw groupsRes.error;
    await fetchRemoteSnapshot();
    return { message: "Group deleted", deleted_todo_count: groupTodos?.length ?? 0 };
  },
  restore: async (id: string) => {
    if (!supabase) throw new Error("Supabase sync is not configured.");
    const { error } = await supabase
      .from("todos")
      .update({ deleted_at: null, updated_at: nowIso() })
      .eq("id", id);
    if (error) throw error;
    await fetchRemoteSnapshot();
    return (await getSnapshot()).todos.find((todo) => todo.id === id)!;
  },
  deletePermanently: async (id: string) => {
    if (!supabase) throw new Error("Supabase sync is not configured.");
    await remoteRemoveTodoFromConnection(id);
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) throw error;
    await fetchRemoteSnapshot();
  },
  empty: async () => {
    if (!supabase) throw new Error("Supabase sync is not configured.");
    const snapshot = await getSnapshot();
    const deletedIds = snapshot.todos.filter((todo) => !!todo.deleted_at).map((todo) => todo.id);
    for (const todoId of deletedIds) {
      await remoteRemoveTodoFromConnection(todoId);
    }
    if (deletedIds.length > 0) {
      const todosRes = await supabase.from("todos").delete().in("id", deletedIds);
      if (todosRes.error) throw todosRes.error;
    }
    const userId = await requireUserId();
    const groupsRes = await supabase
      .from("groups")
      .delete()
      .eq("user_id", userId)
      .not("deleted_at", "is", null);
    if (groupsRes.error) throw groupsRes.error;
    await fetchRemoteSnapshot();
  },
};

export const syncedActivityApi = {
  list: async (limit = 50) => (await maybeRefreshRemote()).activity.slice(0, limit),
  entityHistory: async (entityType: string, entityId: string, limit = 100) =>
    (await maybeRefreshRemote()).activity
      .filter((entry) => entry.entity_type === entityType && entry.entity_id === entityId)
      .slice(0, limit),
};
