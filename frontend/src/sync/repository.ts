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
import { getBranchItemsPreorder } from "../utils/connectionKinds";
import { isBrowserOnline, syncDebugEnabled } from "./config";
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

type TodoRow = Todo & {
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
  parent_todo_id: string | null;
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
let remoteSnapshotPromise: Promise<SyncCacheSnapshot> | null = null;
const REALTIME_REFRESH_DEBOUNCE_MS = 180;
const MAX_CONNECTION_ITEMS = 7;
const MAX_BRANCH_CHILDREN = 2;
const MAX_BRANCH_DEPTH = 7;
const CONNECTION_ITEM_SELECT_FULL = "id,connection_id,todo_id,parent_todo_id,position,created_at";
const CONNECTION_ITEM_SELECT_LEGACY = "id,connection_id,todo_id,position";

function debugSyncLog(...args: unknown[]) {
  if (!syncDebugEnabled) return;
  console.info("[nodes-sync][repo]", ...args);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

function isMissingColumnOrRelationError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("could not find the") ||
    message.includes("column") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

function normalizeConnectionItemRows(rows: Array<Record<string, unknown>> | null | undefined): ConnectionItemRow[] {
  return (rows ?? []).map((row) => ({
    id: String(row.id ?? ""),
    connection_id: String(row.connection_id ?? ""),
    todo_id: String(row.todo_id ?? ""),
    parent_todo_id: typeof row.parent_todo_id === "string" ? row.parent_todo_id : null,
    position: typeof row.position === "number" ? row.position : Number(row.position ?? 0),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  }));
}

function isLegacyCompatibleConnectionItemRows(rows: ConnectionItemRow[]) {
  const rootTodoId = rows.find((row) => row.position === 0)?.todo_id ?? rows[0]?.todo_id ?? null;
  return rows.every((row) => row.parent_todo_id == null || row.parent_todo_id === rootTodoId);
}

function getBranchRootTodoId(items: Array<{ todo_id: string; parent_todo_id: string | null; position: number }>) {
  return items.find((item) => item.parent_todo_id == null)?.todo_id ?? items[0]?.todo_id ?? null;
}

function getEffectiveBranchParentTodoId(
  items: Array<{ todo_id: string; parent_todo_id: string | null; position: number }>,
  item: { todo_id: string; parent_todo_id: string | null }
) {
  if (item.parent_todo_id) return item.parent_todo_id;
  const rootTodoId = getBranchRootTodoId(items);
  if (!rootTodoId || rootTodoId === item.todo_id) return null;
  return rootTodoId;
}

async function fetchConnectionItemsRows(apply: (query: any) => any) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  let result = await apply(supabase.from("connection_items").select(CONNECTION_ITEM_SELECT_FULL));
  if (result.error && isMissingColumnOrRelationError(result.error)) {
    result = await apply(supabase.from("connection_items").select(CONNECTION_ITEM_SELECT_LEGACY));
  }
  if (result.error) throw result.error;
  return normalizeConnectionItemRows(result.data as Array<Record<string, unknown>> | null);
}

async function fetchConnectionItemsForConnection(connectionId: string) {
  const rows = await fetchConnectionItemsRows((query) =>
    query.eq("connection_id", connectionId).order("position", { ascending: true })
  );
  return rows;
}

async function fetchConnectionItemsForConnections(connectionIds: string[]) {
  if (connectionIds.length === 0) return [];
  const rows = await fetchConnectionItemsRows((query) =>
    query.in("connection_id", connectionIds).order("position", { ascending: true })
  );
  return rows;
}

async function insertConnectionItemRows(rows: ConnectionItemRow[]) {
  if (!supabase || rows.length === 0) return;
  let error = (await supabase.from("connection_items").insert(rows)).error;
  if (!error) return;
  if (!isMissingColumnOrRelationError(error)) throw error;

  const withoutCreatedAt = rows.map(({ created_at: _createdAt, ...row }) => row);
  error = (await supabase.from("connection_items").insert(withoutCreatedAt)).error;
  if (!error) return;
  if (!isMissingColumnOrRelationError(error)) throw error;

  if (!isLegacyCompatibleConnectionItemRows(rows)) {
    throw new Error(
      "Your Supabase connection_items table is missing parent_todo_id. Apply the latest schema before using nested branch connections."
    );
  }

  const withoutBranchParentAndCreatedAt = rows.map(
    ({ parent_todo_id: _parentTodoId, created_at: _createdAt, ...row }) => row
  );
  error = (await supabase.from("connection_items").insert(withoutBranchParentAndCreatedAt)).error;
  if (error) throw error;
}

function isDuplicateTodoTitleConstraintError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("todos_user_group_title_active_unique");
}

function isDuplicateGroupNameConstraintError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("groups_user_name_unique");
}

function toRepositoryError(action: string, error: unknown) {
  const message = getErrorMessage(error).trim();
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes("auth-token") ||
    lowerMessage.includes("lock broken") ||
    lowerMessage.includes("not released within")
  ) {
    return new Error("Live sync is still starting up. Please wait a moment and try again.");
  }
  if (
    lowerMessage.includes("sign in to use live sync") ||
    lowerMessage.includes("jwt") ||
    lowerMessage.includes("refresh token") ||
    lowerMessage.includes("session")
  ) {
    return new Error("Your live sync session has expired. Sign in again and retry.");
  }
  if (isMissingColumnOrRelationError(error)) {
    return new Error("Your Supabase schema is out of date. Re-run the latest schema and try again.");
  }
  if (isDuplicateTodoTitleConstraintError(error)) {
    return new Error("A task with this title already exists in this group.");
  }
  if (isDuplicateGroupNameConstraintError(error)) {
    return new Error(
      "A group with this name already exists (including in Trash). Restore or permanently delete it first."
    );
  }
  return new Error(message ? `Failed to ${action}. ${message}` : `Failed to ${action}.`);
}

function nowIso() {
  return new Date().toISOString();
}

function autoCapitalize(str: string): string {
  if (!str.length) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function normalizeTodoTitleForStore(title: string): string {
  return autoCapitalize(title.trim());
}

function normalizeTodoTitleForCompare(title: string): string {
  return title.trim().toLowerCase();
}

function normalizeGroupNameForStore(name: string): string {
  return autoCapitalize(name.trim());
}

function normalizeGroupNameForCompare(name: string): string {
  return name.trim().toLowerCase();
}

function assertNoDuplicateGroupName(groups: Group[], name: string, exceptId?: string) {
  const normalized = normalizeGroupNameForCompare(name);
  const duplicate = groups.some(
    (group) => group.id !== exceptId && normalizeGroupNameForCompare(group.name) === normalized
  );
  if (duplicate) {
    throw new Error(
      "A group with this name already exists (including in Trash). Restore or permanently delete it first."
    );
  }
}

function assertNoDuplicateTodoTitle(
  todos: Todo[],
  groupId: string,
  title: string,
  exceptId?: string
) {
  const normalized = normalizeTodoTitleForCompare(title);
  const duplicate = todos.some(
    (todo) =>
      todo.group_id === groupId &&
      !todo.deleted_at &&
      todo.id !== exceptId &&
      normalizeTodoTitleForCompare(todo.title) === normalized
  );
  if (duplicate) {
    throw new Error("A to-do with this title already exists in this group");
  }
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
    const ordered = getBranchItemsPreorder({
      id: "branch-progress",
      name: null,
      kind: "branch",
      items,
      progress: {
        total: 0,
        completed: 0,
        percentage: 0,
        blocked_count: 0,
        available_count: 0,
        next_available_item_id: null,
      },
      is_fully_complete: false,
      created_at: "",
    });
    const byTodoId = new Map(items.map((item) => [item.todo_id, item] as const));
    const available = ordered.filter((item) => {
      if (item.is_completed === 1) return false;
      let parentId = item.parent_todo_id;
      while (parentId) {
        const parent = byTodoId.get(parentId);
        if (!parent || parent.is_completed !== 1) return false;
        parentId = parent.parent_todo_id;
      }
      return true;
    });
    const availableIds = new Set(available.map((item) => item.todo_id));
    const blocked = ordered.filter((item) => item.is_completed !== 1 && !availableIds.has(item.todo_id));
    const incompleteIds = new Set(items.filter((item) => item.is_completed !== 1).map((item) => item.todo_id));
    const longestPath = (parentTodoId: string | null): number => {
      let best = 0;
      for (const child of items
        .filter((item) => (item.parent_todo_id ?? (ordered[0]?.todo_id === item.todo_id ? null : ordered[0]?.todo_id ?? null)) === parentTodoId)
        .sort((a, b) => a.position - b.position)) {
        const selfCost = incompleteIds.has(child.todo_id) ? 1 : 0;
        best = Math.max(best, selfCost + longestPath(child.todo_id));
      }
      return best;
    };
    nextAvailableItemId = available[0]?.todo_id ?? null;
    availableCount = available.length;
    blockedTitles = blocked.map((item) => item.title);
    blockedCount = blockedTitles.length;
    nextUnlockTitle = blockedTitles[0] ?? null;
    criticalPathLength = longestPath(null);
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
      parent_todo_id: item.parent_todo_id,
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

function buildConnectionsFromSnapshotDraft(snapshot: SyncCacheSnapshot): Connection[] {
  const todoById = new Map(snapshot.todos.map((todo) => [todo.id, todo] as const));
  return snapshot.connections
    .map((connection) => {
      const items = connection.items
        .slice()
        .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))
        .map((item, index) => {
          const todo = todoById.get(item.todo_id);
          if (!todo || todo.deleted_at) return null;
          return {
            ...item,
            parent_todo_id: item.parent_todo_id ?? null,
            title: todo.title,
            is_completed: todo.is_completed,
            high_priority: todo.high_priority,
            completed_at: todo.completed_at,
            created_at: todo.created_at,
            position: index,
          };
        })
        .filter(Boolean) as ConnectionItem[];
      return {
        ...connection,
        items,
        progress: buildConnectionProgress(connection.kind, items),
        is_fully_complete: items.length > 0 && items.every((item) => item.is_completed === 1),
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

  const [groupsRes, todosRes] = await Promise.all([
    supabase.from("groups").select("*").eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("todos").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
  ]);

  if (groupsRes.error) throw groupsRes.error;
  if (todosRes.error) throw todosRes.error;

  const groups = (groupsRes.data as GroupRow[])
    .filter((group) => !group.deleted_at)
    .map(({ deleted_at: _deletedAt, user_id: _userId, ...group }) => group);
  const todos = (todosRes.data as TodoRow[]).map(({ user_id: _userId, ...todo }) => todo);
  let connections: Connection[] = [];
  try {
    const connectionsRes = await supabase
      .from("connections")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (connectionsRes.error) throw connectionsRes.error;

    const connectionRows = connectionsRes.data as ConnectionRow[];
    const connectionIds = connectionRows.map((connection) => connection.id);

    let itemRows: ConnectionItemRow[] = [];
    if (connectionIds.length > 0) {
      itemRows = await fetchConnectionItemsForConnections(connectionIds);
    }

    connections = buildConnections(
      connectionRows,
      itemRows,
      todos
    );
  } catch (error) {
    console.warn("Live sync connections are unavailable; continuing without them.", error);
  }
  let activity = (memorySnapshot?.activity ?? []).slice(0, 200);
  try {
    const activityRes = await supabase
      .from("activity_logs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (activityRes.error) {
      console.warn("Live sync activity feed is unavailable; continuing without it.", activityRes.error);
    } else {
      activity = (activityRes.data as ActivityRow[]).map(normalizeActivity);
    }
  } catch (error) {
    console.warn("Live sync activity fetch failed; continuing without it.", error);
  }

  const snapshot: SyncCacheSnapshot = {
    groups,
    todos,
    connections,
    activity,
    lastSyncedAt: nowIso(),
  };
  await commitSnapshot(snapshot);
  debugSyncLog("snapshot:updated", {
    groups: snapshot.groups.length,
    todos: snapshot.todos.length,
    connections: snapshot.connections.length,
    activity: snapshot.activity.length,
  });
  return snapshot;
}

async function refreshRemoteSnapshot() {
  if (remoteSnapshotPromise) return remoteSnapshotPromise;
  remoteSnapshotPromise = fetchRemoteSnapshot().finally(() => {
    remoteSnapshotPromise = null;
  });
  return remoteSnapshotPromise;
}

async function maybeRefreshRemote() {
  const snapshot = await getSnapshot();
  if (!supabase || !activeSession || !isBrowserOnline()) {
    return snapshot;
  }
  if (!snapshot.lastSyncedAt) {
    return refreshRemoteSnapshot();
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
  if (error) {
    console.warn("Live sync activity write failed; continuing without blocking the main action.", error);
  }
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

async function listConnectionRowIdsByTodoId(todoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data, error } = await supabase
    .from("connection_items")
    .select("connection_id")
    .eq("todo_id", todoId);
  if (error) throw error;
  return (data ?? []).map((row) => row.connection_id as string);
}

function buildMergedTodoIds(
  fromIds: string[],
  toIds: string[],
  fromTodoId: string,
  toTodoId: string,
  mergedKind: ConnectionKind
) {
  if (fromIds.length < 1 || toIds.length < 1) {
    throw new Error("Cannot merge empty connections.");
  }

  const orientFrom = () => {
    if (fromIds[fromIds.length - 1] === fromTodoId) return fromIds;
    if (fromIds[0] === fromTodoId) return [...fromIds].reverse();
    return null;
  };

  const orientTo = () => {
    if (toIds[0] === toTodoId) return toIds;
    if (toIds[toIds.length - 1] === toTodoId) return [...toIds].reverse();
    return null;
  };

  const fromChain = orientFrom();
  const toChain = orientTo();
  if (!fromChain || !toChain) {
    throw new Error(
      "Merge requires linking chain endpoints. Select an endpoint task from each connection."
    );
  }

  const overlap = fromChain.some((id) => toChain.includes(id));
  if (overlap) {
    throw new Error("Cannot merge connections that share tasks.");
  }

  const mergedTodoIds = [...fromChain, ...toChain];
  if (mergedTodoIds.length > MAX_CONNECTION_ITEMS) {
    throw new Error("Merged connection exceeds max depth of 7 items.");
  }
  if (mergedKind === "branch") {
    throw new Error("Merging existing branch trees is not supported. Attach new child tasks directly to a branch node.");
  }
  if (new Set(mergedTodoIds).size !== mergedTodoIds.length) {
    throw new Error("Merged chain produced duplicate tasks.");
  }

  return mergedTodoIds;
}

function ensureConnectionSizeAllowed(_kind: ConnectionKind, itemCount: number) {
  if (itemCount > MAX_CONNECTION_ITEMS) {
    throw new Error("Connections can have at most 7 items.");
  }
}

async function remoteCleanupConnection(connectionId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const items = await fetchConnectionItemsForConnection(connectionId);
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
  const normalizedName = normalizeGroupNameForStore(name);
  if (!normalizedName) {
    throw new Error("Name is required and must be a non-empty string");
  }
  const snapshot = await getSnapshot();
  assertNoDuplicateGroupName(snapshot.groups, normalizedName);
  const { data: remoteGroups, error: remoteGroupsError } = await supabase
    .from("groups")
    .select("id,name")
    .eq("user_id", userId);
  if (remoteGroupsError) throw toRepositoryError("create the group", remoteGroupsError);
  const hasRemoteDuplicate = (remoteGroups ?? []).some((group) => {
    const remoteName = typeof group.name === "string" ? group.name : "";
    return normalizeGroupNameForCompare(remoteName) === normalizeGroupNameForCompare(normalizedName);
  });
  if (hasRemoteDuplicate) {
    throw new Error(
      "A group with this name already exists (including in Trash). Restore or permanently delete it first."
    );
  }
  const position = snapshot.groups.length;
  const timestamp = nowIso();
  const row: GroupRow = {
    id,
    user_id: userId,
    name: normalizedName,
    position,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  let error = (await supabase.from("groups").insert(row)).error;
  if (error && isMissingColumnOrRelationError(error)) {
    error = (
      await supabase.from("groups").insert({
        id,
        user_id: userId,
        name: normalizedName,
        position,
        created_at: timestamp,
        updated_at: timestamp,
      })
    ).error;
  }
  if (error) throw toRepositoryError("create the group", error);
  await writeRemoteActivity("group", id, "created", `Created group "${normalizedName}".`, {
    name: normalizedName,
  });
  return {
    id,
    name: normalizedName,
    position,
    created_at: timestamp,
    updated_at: timestamp,
  } satisfies Group;
}

async function updateGroupRemote(id: string, name: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const normalizedName = normalizeGroupNameForStore(name);
  if (!normalizedName) {
    throw new Error("Name is required and must be a non-empty string");
  }
  const userId = await requireUserId();
  const { data: remoteGroups, error: remoteGroupsError } = await supabase
    .from("groups")
    .select("id,name")
    .eq("user_id", userId);
  if (remoteGroupsError) throw toRepositoryError("rename the group", remoteGroupsError);
  const hasRemoteDuplicate = (remoteGroups ?? []).some((group) => {
    if (group.id === id) return false;
    const remoteName = typeof group.name === "string" ? group.name : "";
    return normalizeGroupNameForCompare(remoteName) === normalizeGroupNameForCompare(normalizedName);
  });
  if (hasRemoteDuplicate) {
    throw new Error(
      "A group with this name already exists (including in Trash). Restore or permanently delete it first."
    );
  }
  const timestamp = nowIso();
  const { error } = await supabase
    .from("groups")
    .update({ name: normalizedName, updated_at: timestamp })
    .eq("id", id);
  if (error) throw toRepositoryError("rename the group", error);
  await writeRemoteActivity("group", id, "updated", `Renamed group to "${normalizedName}".`, {
    name: normalizedName,
  });
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
  const normalizedTitle = normalizeTodoTitleForStore(title);
  const normalizedTitleCompare = normalizeTodoTitleForCompare(normalizedTitle);
  if (!normalizedTitle) {
    throw new Error("Title is required and must be a non-empty string");
  }
  const snapshot = await getSnapshot();
  assertNoDuplicateTodoTitle(snapshot.todos, groupId, normalizedTitle);
  const { data: remoteTodos, error: remoteTodosError } = await supabase
    .from("todos")
    .select("id,title")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .is("deleted_at", null);
  if (remoteTodosError) throw toRepositoryError("create the task", remoteTodosError);
  const hasRemoteDuplicate = (remoteTodos ?? []).some((todo) => {
    const remoteTitle = typeof todo.title === "string" ? todo.title : "";
    return normalizeTodoTitleForCompare(remoteTitle) === normalizedTitleCompare;
  });
  if (hasRemoteDuplicate) {
    throw new Error("A to-do with this title already exists in this group");
  }
  const groupTodos = snapshot.todos.filter((todo) => todo.group_id === groupId && !todo.deleted_at);
  const position = groupTodos.length;
  const timestamp = nowIso();
  const row: TodoRow = {
    id,
    user_id: userId,
    group_id: groupId,
    title: normalizedTitle,
    description: description ?? null,
    high_priority: options?.high_priority ? 1 : 0,
    reminder_at: (options?.reminder_at as string | null | undefined) ?? null,
    recurrence_rule: (options?.recurrence_rule as Todo["recurrence_rule"] | null | undefined) ?? null,
    recurrence_enabled: options?.recurrence_rule ? 1 : 0,
    next_occurrence_at: null,
    is_completed: 0,
    completed_at: null,
    position,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  let error = (await supabase.from("todos").insert(row)).error;
  if (error && isMissingColumnOrRelationError(error)) {
    error = (
      await supabase.from("todos").insert({
        id,
        user_id: userId,
        group_id: groupId,
        title: normalizedTitle,
        description: description ?? null,
        high_priority: options?.high_priority ? 1 : 0,
        reminder_at: (options?.reminder_at as string | null | undefined) ?? null,
        is_completed: 0,
        completed_at: null,
        position,
        created_at: timestamp,
        updated_at: timestamp,
      })
    ).error;
  }
  if (error) throw toRepositoryError("create the task", error);
  await writeRemoteActivity("todo", id, "created", `Created task "${normalizedTitle}".`, {
    title: normalizedTitle,
    group_id: groupId,
  });
  const { user_id: _userId, ...todo } = row;
  return todo;
}

async function updateTodoRemote(id: string, data: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data: currentTodo, error: currentTodoError } = await supabase
    .from("todos")
    .select("id,user_id,group_id,title,deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (currentTodoError) throw toRepositoryError("update the task", currentTodoError);
  if (!currentTodo) throw new Error("Task not found.");
  const currentGroupId = currentTodo.group_id as string;
  const currentUserId = currentTodo.user_id as string;
  const timestamp = nowIso();
  const patch: Record<string, unknown> = { ...data, updated_at: timestamp };
  if ("title" in patch && patch.title !== undefined) {
    if (typeof patch.title !== "string" || !patch.title.trim()) {
      throw new Error("Title must be a non-empty string");
    }
    patch.title = normalizeTodoTitleForStore(patch.title);
    const normalizedTitleCompare = normalizeTodoTitleForCompare(patch.title as string);
    const { data: remoteTodos, error: remoteTodosError } = await supabase
      .from("todos")
      .select("id,title")
      .eq("user_id", currentUserId)
      .eq("group_id", currentGroupId)
      .is("deleted_at", null);
    if (remoteTodosError) throw toRepositoryError("update the task", remoteTodosError);
    const hasRemoteDuplicate = (remoteTodos ?? []).some((todo) => {
      if (todo.id === id) return false;
      const remoteTitle = typeof todo.title === "string" ? todo.title : "";
      return normalizeTodoTitleForCompare(remoteTitle) === normalizedTitleCompare;
    });
    if (hasRemoteDuplicate) {
      throw new Error("A to-do with this title already exists in this group");
    }
  }
  if ("high_priority" in patch) {
    patch.high_priority = patch.high_priority ? 1 : 0;
  }
  if ("recurrence_rule" in patch) {
    patch.recurrence_enabled = patch.recurrence_rule ? 1 : 0;
  }
  const { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error) throw toRepositoryError("update the task", error);
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
  ensureConnectionSizeAllowed(kind, todoIds.length);
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
    parent_todo_id: kind === "branch" ? (index === 0 ? null : todoIds[0] ?? null) : null,
    position: index,
    created_at: timestamp,
  }));
  await insertConnectionItemRows(itemRows);
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

async function addConnectionItemRemote(connectionId: string, todoId: string, parentTodoId?: string | null) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const existingConnectionId = await findConnectionRowByTodoId(todoId);
  if (existingConnectionId) {
    throw new Error("This task is already in another connection.");
  }
  const { data: connectionRow, error: connectionError } = await supabase
    .from("connections")
    .select("kind")
    .eq("id", connectionId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connectionRow) throw new Error("Connection not found.");
  const items = (await fetchConnectionItemsForConnection(connectionId)).map((item) => ({
    todo_id: item.todo_id,
    parent_todo_id: item.parent_todo_id,
    position: item.position,
  }));
  let nextPosition = ((items[items.length - 1]?.position as number | undefined) ?? -1) + 1;
  let normalizedParentTodoId: string | null = null;

  if ((connectionRow.kind as ConnectionKind) === "branch") {
    if (!parentTodoId) {
      throw new Error("parentTodoId is required when adding to a branch tree.");
    }
    normalizedParentTodoId = parentTodoId;
    const parent = items.find((item) => item.todo_id === parentTodoId);
    if (!parent) {
      throw new Error("Branch parent was not found in this connection.");
    }
    const directChildren = items.filter(
      (item) => getEffectiveBranchParentTodoId(items, item) === parentTodoId
    );
    if (directChildren.length >= MAX_BRANCH_CHILDREN) {
      throw new Error(`Branch nodes can have at most ${MAX_BRANCH_CHILDREN} children.`);
    }
    const byTodoId = new Map(items.map((item) => [item.todo_id, item] as const));
    let parentDepth = 1;
    let cursorParentId = getEffectiveBranchParentTodoId(items, parent);
    while (cursorParentId) {
      parentDepth += 1;
      const ancestor = byTodoId.get(cursorParentId);
      cursorParentId = ancestor ? getEffectiveBranchParentTodoId(items, ancestor) : null;
    }
    if (parentDepth + 1 > MAX_BRANCH_DEPTH) {
      throw new Error(`Branch connections can have at most depth ${MAX_BRANCH_DEPTH}.`);
    }
    const descendants = new Set<string>();
    const collectDescendants = (currentTodoId: string) => {
      for (const child of items
        .filter((item) => getEffectiveBranchParentTodoId(items, item) === currentTodoId)
        .sort((a, b) => a.position - b.position)) {
        descendants.add(child.todo_id);
        collectDescendants(child.todo_id);
      }
    };
    collectDescendants(parentTodoId);
    nextPosition =
      Math.max(
        parent.position,
        ...items.filter((item) => item.todo_id === parentTodoId || descendants.has(item.todo_id)).map((item) => item.position)
      ) + 1;

    const rowsToShift = items
      .filter((item) => item.position >= nextPosition)
      .sort((first, second) => second.position - first.position);
    for (const row of rowsToShift) {
      const { error: shiftError } = await supabase
        .from("connection_items")
        .update({ position: row.position + 1 })
        .eq("connection_id", connectionId)
        .eq("todo_id", row.todo_id);
      if (shiftError) throw shiftError;
    }
  }

  ensureConnectionSizeAllowed(connectionRow.kind as ConnectionKind, items.length + 1);
  await insertConnectionItemRows([{
    id: crypto.randomUUID(),
    connection_id: connectionId,
    todo_id: todoId,
    parent_todo_id: normalizedParentTodoId,
    position: nextPosition,
    created_at: nowIso(),
  }]);
  await writeRemoteActivity("connection", connectionId, "item_added", "Added a task to the connection.", {
    todoId,
  });
}

async function mergeConnectionsRemote(fromTodoId: string, toTodoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const sourceMatches = await listConnectionRowIdsByTodoId(fromTodoId);
  const targetMatches = await listConnectionRowIdsByTodoId(toTodoId);

  if (sourceMatches.length > 1) {
    throw new Error("Selected source task belongs to multiple connections. Choose a chain endpoint.");
  }
  if (targetMatches.length > 1) {
    throw new Error("Selected target task belongs to multiple connections. Choose a chain endpoint.");
  }

  const fromConnectionId = sourceMatches[0];
  const toConnectionId = targetMatches[0];
  if (!fromConnectionId || !toConnectionId) {
    throw new Error("Both tasks must already belong to a connection to merge them.");
  }
  if (fromConnectionId === toConnectionId) {
    return remoteBuildConnection(fromConnectionId);
  }

  const { data: connectionRows, error: connectionRowsError } = await supabase
    .from("connections")
    .select("id,kind,created_at")
    .in("id", [fromConnectionId, toConnectionId]);
  if (connectionRowsError) throw connectionRowsError;

  const sourceConnection = (connectionRows ?? []).find((row) => row.id === fromConnectionId);
  const targetConnection = (connectionRows ?? []).find((row) => row.id === toConnectionId);
  if (!sourceConnection || !targetConnection) {
    throw new Error("One of the connections was not found.");
  }
  if (sourceConnection.kind === "branch" || targetConnection.kind === "branch") {
    throw new Error("Merging existing branch trees is not supported. Attach new child tasks directly to a branch node.");
  }

  const { data: sourceItems, error: sourceItemsError } = await supabase
    .from("connection_items")
    .select("todo_id")
    .eq("connection_id", fromConnectionId)
    .order("position", { ascending: true });
  if (sourceItemsError) throw sourceItemsError;

  const { data: targetItems, error: targetItemsError } = await supabase
    .from("connection_items")
    .select("todo_id")
    .eq("connection_id", toConnectionId)
    .order("position", { ascending: true });
  if (targetItemsError) throw targetItemsError;

  const mergeInputs = [
    {
      id: sourceConnection.id,
      kind: sourceConnection.kind as ConnectionKind,
      created_at: sourceConnection.created_at as string,
      anchorTodoId: fromTodoId,
      todoIds: (sourceItems ?? []).map((item) => item.todo_id as string),
    },
    {
      id: targetConnection.id,
      kind: targetConnection.kind as ConnectionKind,
      created_at: targetConnection.created_at as string,
      anchorTodoId: toTodoId,
      todoIds: (targetItems ?? []).map((item) => item.todo_id as string),
    },
  ].sort((a, b) => {
    const createdAtCompare = a.created_at.localeCompare(b.created_at);
    if (createdAtCompare !== 0) return createdAtCompare;
    return a.id.localeCompare(b.id);
  });

  const primary = mergeInputs[0]!;
  const secondary = mergeInputs[1]!;

  const allTodoIds = buildMergedTodoIds(
    primary.todoIds,
    secondary.todoIds,
    primary.anchorTodoId,
    secondary.anchorTodoId,
    primary.kind
  );

  await supabase.from("connection_items").delete().eq("connection_id", primary.id);
  await supabase.from("connection_items").delete().eq("connection_id", secondary.id);
  await supabase
    .from("connections")
    .update({ deleted_at: nowIso(), updated_at: nowIso() })
    .eq("id", secondary.id);

  const rows: ConnectionItemRow[] = allTodoIds.map((todoId, index) => ({
    id: crypto.randomUUID(),
    connection_id: primary.id,
    todo_id: todoId,
    parent_todo_id: null,
    position: index,
    created_at: nowIso(),
  }));
  await insertConnectionItemRows(rows);
  await writeRemoteActivity("connection", primary.id, "merged", "Merged two connections.", {
    fromTodoId,
    toTodoId,
  });
  return remoteBuildConnection(primary.id);
}

async function cutConnectionRemote(connectionId: string, fromTodoId: string, toTodoId: string) {
  if (!supabase) throw new Error("Supabase sync is not configured.");
  const { data: connectionRow, error: connectionError } = await supabase
    .from("connections")
    .select("kind")
    .eq("id", connectionId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (connectionRow?.kind === "branch") {
    throw new Error("Cut is not supported for branch trees. Remove a leaf branch node instead.");
  }
  const items = await fetchConnectionItemsForConnection(connectionId);
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
    await insertConnectionItemRows(
      left.map((item, index) => ({
        id: crypto.randomUUID(),
        connection_id: connectionId,
        todo_id: item.todo_id,
        parent_todo_id: item.parent_todo_id ?? null,
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
  const rows = await fetchConnectionItemsForConnection(connectionId);
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
  const { data: connectionRow, error: connectionError } = await supabase
    .from("connections")
    .select("kind")
    .eq("id", connectionId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  const items = await fetchConnectionItemsForConnection(connectionId);
  if (connectionRow?.kind === "branch") {
    const target = items.find((item) => item.todo_id === todoId);
    if (!target) throw new Error("Task is not part of this connection.");
    if (getEffectiveBranchParentTodoId(items, target) == null) {
      throw new Error("Cannot remove the root of a branch tree.");
    }
    if (items.some((item) => getEffectiveBranchParentTodoId(items, item) === todoId)) {
      throw new Error("Remove child branches first. Only leaf branch nodes can be removed.");
    }
  }
  const { error: deleteError } = await supabase
    .from("connection_items")
    .delete()
    .eq("connection_id", connectionId)
    .eq("todo_id", todoId);
  if (deleteError) throw deleteError;

  const remaining = items.filter((item) => item.todo_id !== todoId);
  for (let index = 0; index < remaining.length; index += 1) {
    const row = remaining[index]!;
    const { error: updateError } = await supabase
      .from("connection_items")
      .update({ position: index })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }
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
      await addConnectionItemRemote(
        operation.payload.connectionId as string,
        operation.payload.todoId as string,
        (operation.payload.parentTodoId as string | null | undefined) ?? null
      );
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
    if (operations.length > 0) {
      await refreshRemoteSnapshot();
    }
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
  await withOfflineFallback(refreshRemoteSnapshot, getSnapshot);
  await flushPendingOperations();
}

export function subscribeToRealtime(onInvalidate: () => void) {
  if (!supabase || !activeSession) return () => {};
  let realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let realtimeRefreshPromise: Promise<void> | null = null;

  const scheduleRealtimeRefresh = () => {
    if (realtimeRefreshTimer) return;
    realtimeRefreshTimer = setTimeout(() => {
      realtimeRefreshTimer = null;
      if (realtimeRefreshPromise) return;
      realtimeRefreshPromise = (async () => {
        await refreshRemoteSnapshot();
        onInvalidate();
      })().finally(() => {
        realtimeRefreshPromise = null;
      });
    }, REALTIME_REFRESH_DEBOUNCE_MS);
  };

  realtimeChannel?.unsubscribe();
  realtimeChannel = supabase
    .channel(`nodes-sync-${activeSession.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, () => {
      scheduleRealtimeRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => {
      scheduleRealtimeRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "connections" }, () => {
      scheduleRealtimeRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "connection_items" }, () => {
      scheduleRealtimeRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, () => {
      scheduleRealtimeRefresh();
    });
  realtimeChannel.subscribe();

  const onOnline = () => {
    void flushPendingOperations();
    void refreshRemoteSnapshot().then(onInvalidate);
  };
  window.addEventListener("online", onOnline);

  return () => {
    realtimeChannel?.unsubscribe();
    realtimeChannel = null;
    if (realtimeRefreshTimer) {
      clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = null;
    }
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
        const normalizedName = normalizeGroupNameForStore(name);
        if (!normalizedName) {
          throw new Error("Name is required and must be a non-empty string");
        }
        const snapshot = await getSnapshot();
        assertNoDuplicateGroupName(snapshot.groups, normalizedName);
        const group = await createGroupRemote(normalizedName);
        await mutateSnapshot((snapshot) => {
          snapshot.groups = [...snapshot.groups, group].sort((a, b) => a.position - b.position);
        });
        return group;
      },
      async () => {
        const normalizedName = normalizeGroupNameForStore(name);
        if (!normalizedName) {
          throw new Error("Name is required and must be a non-empty string");
        }
        const snapshot = await getSnapshot();
        assertNoDuplicateGroupName(snapshot.groups, normalizedName);
        const group: Group = {
          id: crypto.randomUUID(),
          name: normalizedName,
          position: snapshot.groups.length,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        await mutateSnapshot((snapshot) => {
          snapshot.groups.push(group);
          appendLocalActivity(snapshot, {
            entityType: "group",
            entityId: group.id,
            action: "queued_create",
            summary: `Queued creation of group "${normalizedName}" while offline.`,
          });
        });
        await queueOperation({
          kind: "group.create",
          payload: { id: group.id, name: normalizedName },
        });
        return group;
      }
    ),
  update: async (id: string, name: string) =>
    withOfflineFallback(
      async () => {
        const normalizedName = normalizeGroupNameForStore(name);
        if (!normalizedName) {
          throw new Error("Name is required and must be a non-empty string");
        }
        const snapshot = await getSnapshot();
        const current = snapshot.groups.find((group) => group.id === id);
        if (!current) throw new Error("Group not found.");
        assertNoDuplicateGroupName(snapshot.groups, normalizedName, id);
        await updateGroupRemote(id, normalizedName);
        const refreshed = await getSnapshot();
        const latest = refreshed.groups.find((group) => group.id === id);
        if (!latest) throw new Error("Group not found.");
        const next = { ...latest, name: normalizedName, updated_at: nowIso() };
        await mutateSnapshot((draft) => {
          draft.groups = draft.groups.map((group) => (group.id === id ? next : group));
        });
        return next;
      },
      async () => {
        const normalizedName = normalizeGroupNameForStore(name);
        if (!normalizedName) {
          throw new Error("Name is required and must be a non-empty string");
        }
        const snapshot = await getSnapshot();
        const current = snapshot.groups.find((group) => group.id === id);
        if (!current) throw new Error("Group not found.");
        assertNoDuplicateGroupName(snapshot.groups, normalizedName, id);
        const updatedAt = nowIso();
        await mutateSnapshot((draft) => {
          draft.groups = draft.groups.map((group) =>
            group.id === id ? { ...group, name: normalizedName, updated_at: updatedAt } : group
          );
        });
        await queueOperation({
          kind: "group.update",
          payload: { id, name: normalizedName, baseUpdatedAt: current.updated_at },
        });
        return { ...current, name: normalizedName, updated_at: updatedAt };
      }
    ),
  delete: async (id: string) =>
    withOfflineFallback(
      async () => {
        await remoteGroupDelete(id);
        const timestamp = nowIso();
        await mutateSnapshot((snapshot) => {
          snapshot.groups = snapshot.groups.filter((group) => group.id !== id);
          snapshot.todos = snapshot.todos.map((todo) =>
            todo.group_id === id ? { ...todo, deleted_at: timestamp, updated_at: timestamp } : todo
          );
          snapshot.connections = snapshot.connections
            .map((connection) => {
              const items = connection.items.filter((item) =>
                snapshot.todos.some((todo) => todo.id === item.todo_id && todo.group_id !== id)
              );
              return {
                ...connection,
                items,
                progress: buildConnectionProgress(connection.kind, items),
                is_fully_complete: items.length > 0 && items.every((item) => item.is_completed === 1),
              };
            })
            .filter((connection) => connection.items.length >= 2);
        });
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
        const updatedAt = nowIso();
        await mutateSnapshot((snapshot) => {
          const positions = new Map(items.map((item) => [item.id, item.position]));
          snapshot.groups = snapshot.groups
            .map((group) => ({
              ...group,
              position: positions.get(group.id) ?? group.position,
              updated_at: positions.has(group.id) ? updatedAt : group.updated_at,
            }))
            .sort((a, b) => a.position - b.position);
        });
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
        const normalizedTitle = normalizeTodoTitleForStore(title);
        if (!normalizedTitle) {
          throw new Error("Title is required and must be a non-empty string");
        }
        const snapshot = await getSnapshot();
        assertNoDuplicateTodoTitle(snapshot.todos, groupId, normalizedTitle);
        const todo = await createTodoRemote(groupId, normalizedTitle, description, options);
        await mutateSnapshot((draft) => {
          draft.todos.push(todo);
        });
        return todo;
      },
      async () => {
        const snapshot = await getSnapshot();
        const normalizedTitle = normalizeTodoTitleForStore(title);
        if (!normalizedTitle) {
          throw new Error("Title is required and must be a non-empty string");
        }
        assertNoDuplicateTodoTitle(snapshot.todos, groupId, normalizedTitle);
        const groupTodos = snapshot.todos.filter((todo) => todo.group_id === groupId && !todo.deleted_at);
        const todo: Todo = {
          id: crypto.randomUUID(),
          group_id: groupId,
          title: normalizedTitle,
          description: description ?? null,
          high_priority: options?.high_priority ? 1 : 0,
          reminder_at: (options?.reminder_at as string | null | undefined) ?? null,
          recurrence_rule: (options?.recurrence_rule as Todo["recurrence_rule"] | null | undefined) ?? null,
          recurrence_enabled: options?.recurrence_rule ? 1 : 0,
          next_occurrence_at: null,
          is_completed: 0,
          completed_at: null,
          position: groupTodos.length,
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
            summary: `Queued creation of "${normalizedTitle}" while offline.`,
          });
        });
        await queueOperation({
          kind: "todo.create",
          payload: { id: todo.id, groupId, title: normalizedTitle, description, options },
        });
        return todo;
      }
    ),
  update: async (id: string, data: Record<string, unknown>) =>
    withOfflineFallback(
      async () => {
        const normalizedData: Record<string, unknown> = { ...data };
        if ("high_priority" in normalizedData) {
          normalizedData.high_priority = normalizedData.high_priority ? 1 : 0;
        }
        const snapshot = await getSnapshot();
        const current = snapshot.todos.find((todo) => todo.id === id);
        if (!current) throw new Error("Task not found.");
        if ("title" in normalizedData && normalizedData.title !== undefined) {
          if (typeof normalizedData.title !== "string" || !normalizedData.title.trim()) {
            throw new Error("Title must be a non-empty string");
          }
          normalizedData.title = normalizeTodoTitleForStore(normalizedData.title);
          assertNoDuplicateTodoTitle(
            snapshot.todos,
            current.group_id,
            normalizedData.title as string,
            id
          );
        }
        await updateTodoRemote(id, normalizedData);
        const next: Todo = {
          ...current,
          ...normalizedData,
          recurrence_enabled:
            "recurrence_rule" in normalizedData
              ? normalizedData.recurrence_rule
                ? 1
                : 0
              : current.recurrence_enabled,
          updated_at: nowIso(),
        };
        await mutateSnapshot((draft) => {
          draft.todos = draft.todos.map((todo) => (todo.id === id ? next : todo));
          draft.connections = buildConnectionsFromSnapshotDraft(draft);
        });
        return next;
      },
      async () => {
        const normalizedData: Record<string, unknown> = { ...data };
        if ("high_priority" in normalizedData) {
          normalizedData.high_priority = normalizedData.high_priority ? 1 : 0;
        }
        const snapshot = await getSnapshot();
        const current = snapshot.todos.find((todo) => todo.id === id);
        if (!current) throw new Error("Task not found.");
        if ("title" in normalizedData && normalizedData.title !== undefined) {
          if (typeof normalizedData.title !== "string" || !normalizedData.title.trim()) {
            throw new Error("Title must be a non-empty string");
          }
          normalizedData.title = normalizeTodoTitleForStore(normalizedData.title);
          assertNoDuplicateTodoTitle(
            snapshot.todos,
            current.group_id,
            normalizedData.title as string,
            id
          );
        }
        const next: Todo = {
          ...current,
          ...normalizedData,
          recurrence_enabled:
            "recurrence_rule" in normalizedData
              ? normalizedData.recurrence_rule
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
          payload: { id, data: normalizedData, baseUpdatedAt: current.updated_at },
        });
        return next;
      }
    ),
  acknowledgeReminder: async (id: string) => syncedTodosApi.update(id, { reminder_at: null }),
  toggleComplete: async (id: string) =>
    withOfflineFallback(
      async () => {
        await toggleTodoRemote(id);
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
          draft.connections = buildConnectionsFromSnapshotDraft(draft);
        });
        return next;
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
        const timestamp = nowIso();
        await mutateSnapshot((draft) => {
          draft.todos = draft.todos.map((todo) =>
            todo.id === id ? { ...todo, deleted_at: timestamp, updated_at: timestamp } : todo
          );
          draft.connections = draft.connections
            .map((connection) => {
              const items = connection.items.filter((item) => item.todo_id !== id);
              return {
                ...connection,
                items,
                progress: buildConnectionProgress(connection.kind, items),
                is_fully_complete: items.length > 0 && items.every((item) => item.is_completed === 1),
              };
            })
            .filter((connection) => connection.items.length >= 2);
        });
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
        const updatedAt = nowIso();
        await mutateSnapshot((draft) => {
          const positions = new Map(items.map((item) => [item.id, item.position]));
          draft.todos = draft.todos.map((todo) =>
            positions.has(todo.id)
              ? { ...todo, position: positions.get(todo.id)!, updated_at: updatedAt }
              : todo
          );
        });
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
        await mutateSnapshot((draft) => {
          const existingIndex = draft.connections.findIndex((item) => item.id === connection.id);
          if (existingIndex >= 0) {
            draft.connections[existingIndex] = connection;
          } else {
            draft.connections.push(connection);
          }
        });
        return connection;
      },
      async () => {
        const snapshot = await getSnapshot();
        const normalizedKind = kind ?? "sequence";
        ensureConnectionSizeAllowed(normalizedKind, todoIds.length);
        const todoById = new Map(snapshot.todos.map((todo) => [todo.id, todo]));
        for (const todoId of todoIds) {
          if (snapshot.connections.some((connection) => connection.items.some((item) => item.todo_id === todoId))) {
            throw new Error("A task can only belong to one connection.");
          }
        }
        const connection: Connection = {
          id: crypto.randomUUID(),
          name: name ?? null,
          kind: normalizedKind,
          items: todoIds.map((todoId, index) => {
            const todo = todoById.get(todoId);
            if (!todo) throw new Error("Task not found.");
            return {
              id: crypto.randomUUID(),
              todo_id: todo.id,
              parent_todo_id: normalizedKind === "branch" ? (index === 0 ? null : todoIds[0] ?? null) : null,
              title: todo.title,
              is_completed: todo.is_completed,
              high_priority: todo.high_priority,
              completed_at: todo.completed_at,
              created_at: todo.created_at,
              position: index,
            };
          }),
          progress: buildConnectionProgress(normalizedKind, []),
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
        if (data.kind === "branch") {
          const snapshot = await getSnapshot();
          const current = snapshot.connections.find((connection) => connection.id === id);
          if (!current) throw new Error("Connection not found.");
          ensureConnectionSizeAllowed("branch", current.items.length);
        }
        await updateConnectionRemote(id, data);
        const snapshot = await getSnapshot();
        const current = snapshot.connections.find((connection) => connection.id === id);
        if (!current) throw new Error("Connection not found.");
        const next = {
          ...current,
          ...data,
          progress: buildConnectionProgress(data.kind ?? current.kind, current.items),
        };
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.map((connection) =>
            connection.id === id ? next : connection
          );
        });
        return next;
      },
      async () => {
        const snapshot = await getSnapshot();
        const current = snapshot.connections.find((connection) => connection.id === id);
        if (!current) throw new Error("Connection not found.");
        if (data.kind === "branch") {
          ensureConnectionSizeAllowed("branch", current.items.length);
        }
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
  addItem: async (connectionId: string, todoId: string, parentTodoId?: string | null) =>
    withOfflineFallback(
      async () => {
        await addConnectionItemRemote(connectionId, todoId, parentTodoId);
        const snapshot = await getSnapshot();
        const todo = snapshot.todos.find((item) => item.id === todoId);
        if (!todo) throw new Error("Task not found.");
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.map((connection) => {
            if (connection.id !== connectionId) return connection;
            ensureConnectionSizeAllowed(connection.kind, connection.items.length + 1);
            const items = [...connection.items];
            let insertPosition = items.length;
            let normalizedParentTodoId: string | null = null;
            if (connection.kind === "branch") {
              if (!parentTodoId) throw new Error("parentTodoId is required when adding to a branch tree.");
              normalizedParentTodoId = parentTodoId;
              const directChildren = items.filter(
                (item) => getEffectiveBranchParentTodoId(items, item) === parentTodoId
              );
              if (directChildren.length >= MAX_BRANCH_CHILDREN) {
                throw new Error(`Branch nodes can have at most ${MAX_BRANCH_CHILDREN} children.`);
              }
              const descendants = new Set<string>();
              const collectDescendants = (currentTodoId: string) => {
                for (const child of items
                  .filter((item) => getEffectiveBranchParentTodoId(items, item) === currentTodoId)
                  .sort((a, b) => a.position - b.position)) {
                  descendants.add(child.todo_id);
                  collectDescendants(child.todo_id);
                }
              };
              collectDescendants(parentTodoId);
              const parent = items.find((item) => item.todo_id === parentTodoId);
              if (!parent) throw new Error("Branch parent was not found in this connection.");
              insertPosition =
                Math.max(
                  parent.position,
                  ...items.filter((item) => item.todo_id === parentTodoId || descendants.has(item.todo_id)).map((item) => item.position)
                ) + 1;
            }
            const shifted = items.map((item) =>
              item.position >= insertPosition ? { ...item, position: item.position + 1 } : item
            );
            const nextItem = {
              id: crypto.randomUUID(),
              todo_id: todoId,
              parent_todo_id: normalizedParentTodoId,
              title: todo.title,
              is_completed: todo.is_completed,
              high_priority: todo.high_priority,
              completed_at: todo.completed_at,
              created_at: todo.created_at,
              position: insertPosition,
            };
            const itemsNext = [...shifted, nextItem].sort((a, b) => a.position - b.position);
            return {
              ...connection,
              items: itemsNext,
              progress: buildConnectionProgress(connection.kind, itemsNext),
              is_fully_complete: itemsNext.length > 0 && itemsNext.every((item) => item.is_completed === 1),
            };
          });
        });
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
            ensureConnectionSizeAllowed(connection.kind, connection.items.length + 1);
            const items = [...connection.items];
            let insertPosition = items.length;
            let normalizedParentTodoId: string | null = null;
            if (connection.kind === "branch") {
              if (!parentTodoId) throw new Error("parentTodoId is required when adding to a branch tree.");
              normalizedParentTodoId = parentTodoId;
              const directChildren = items.filter(
                (item) => getEffectiveBranchParentTodoId(items, item) === parentTodoId
              );
              if (directChildren.length >= MAX_BRANCH_CHILDREN) {
                throw new Error(`Branch nodes can have at most ${MAX_BRANCH_CHILDREN} children.`);
              }
              const descendants = new Set<string>();
              const collectDescendants = (currentTodoId: string) => {
                for (const child of items
                  .filter((item) => getEffectiveBranchParentTodoId(items, item) === currentTodoId)
                  .sort((a, b) => a.position - b.position)) {
                  descendants.add(child.todo_id);
                  collectDescendants(child.todo_id);
                }
              };
              collectDescendants(parentTodoId);
              const parent = items.find((item) => item.todo_id === parentTodoId);
              if (!parent) throw new Error("Branch parent was not found in this connection.");
              insertPosition =
                Math.max(
                  parent.position,
                  ...items.filter((item) => item.todo_id === parentTodoId || descendants.has(item.todo_id)).map((item) => item.position)
                ) + 1;
            }
            const shifted = items.map((item) =>
              item.position >= insertPosition ? { ...item, position: item.position + 1 } : item
            );
            const itemsNext = [
              ...shifted,
              {
                id: crypto.randomUUID(),
                todo_id: todoId,
                parent_todo_id: normalizedParentTodoId,
                title: todo.title,
                is_completed: todo.is_completed,
                high_priority: todo.high_priority,
                completed_at: todo.completed_at,
                created_at: todo.created_at,
                position: insertPosition,
              },
            ].sort((a, b) => a.position - b.position);
            return {
              ...connection,
              items: itemsNext,
              progress: buildConnectionProgress(connection.kind, itemsNext),
            };
          });
        });
        await queueOperation({
          kind: "connection.addItem",
          payload: { connectionId, todoId, parentTodoId: parentTodoId ?? null },
        });
      }
    ),
  merge: async (fromTodoId: string, toTodoId: string) =>
    withOfflineFallback(
      async () => {
        await mergeConnectionsRemote(fromTodoId, toTodoId);
        // Refresh entire snapshot from Supabase to ensure all connections are rebuilt with correct ordering
        await fetchRemoteSnapshot();
        const connection = (await getSnapshot()).connections.find(
          (c) => c.items.some((item) => item.todo_id === fromTodoId) && c.items.some((item) => item.todo_id === toTodoId)
        );
        if (!connection) throw new Error("Merged connection not found after refresh.");
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

        const fromMatches = snapshot.connections.filter((connection) =>
          connection.items.some((item) => item.todo_id === fromTodoId)
        );
        const toMatches = snapshot.connections.filter((connection) =>
          connection.items.some((item) => item.todo_id === toTodoId)
        );
        if (fromMatches.length > 1) {
          throw new Error("Selected source task belongs to multiple connections. Choose a chain endpoint.");
        }
        if (toMatches.length > 1) {
          throw new Error("Selected target task belongs to multiple connections. Choose a chain endpoint.");
        }

        if (!fromConnection || !toConnection) {
          throw new Error("Both tasks must already belong to a connection.");
        }
        if (fromConnection.id === toConnection.id) return fromConnection;
        if (fromConnection.kind === "branch" || toConnection.kind === "branch") {
          throw new Error("Merging existing branch trees is not supported. Attach new child tasks directly to a branch node.");
        }

        const mergeInputs = [
          {
            connection: fromConnection,
            anchorTodoId: fromTodoId,
            todoIds: fromConnection.items.map((item) => item.todo_id),
          },
          {
            connection: toConnection,
            anchorTodoId: toTodoId,
            todoIds: toConnection.items.map((item) => item.todo_id),
          },
        ].sort((a, b) => {
          const createdAtCompare = a.connection.created_at.localeCompare(b.connection.created_at);
          if (createdAtCompare !== 0) return createdAtCompare;
          return a.connection.id.localeCompare(b.connection.id);
        });

        const primary = mergeInputs[0]!;
        const secondary = mergeInputs[1]!;

        const mergedTodoIds = buildMergedTodoIds(
          primary.todoIds,
          secondary.todoIds,
          primary.anchorTodoId,
          secondary.anchorTodoId,
          primary.connection.kind
        );

        const connectionItems = [...primary.connection.items, ...secondary.connection.items];
        const mergedItems = mergedTodoIds.map((todoId, index) => {
          const item = connectionItems.find((connectionItem) => connectionItem.todo_id === todoId);
          if (!item) {
            throw new Error("Failed to assemble merged connection.");
          }
          return {
            ...item,
            position: index,
          };
        });

        const merged = {
          ...primary.connection,
          items: mergedItems,
          progress: buildConnectionProgress(primary.connection.kind, mergedItems),
        };
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections
            .filter((connection) => connection.id !== secondary.connection.id)
            .map((connection) => (connection.id === primary.connection.id ? merged : connection));
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
          is_fully_complete: items.length > 0 && items.every((item) => item.is_completed === 1),
        };
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.map((item) => (item.id === connectionId ? next : item));
        });
        return next;
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
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections
            .map((connection) => {
              if (connection.id !== connectionId) return connection;
              if (connection.kind === "branch") {
                const target = connection.items.find((item) => item.todo_id === todoId);
                if (!target) throw new Error("Task is not part of this connection.");
                if (getEffectiveBranchParentTodoId(connection.items, target) == null) {
                  throw new Error("Cannot remove the root of a branch tree.");
                }
                if (connection.items.some((item) => getEffectiveBranchParentTodoId(connection.items, item) === todoId)) {
                  throw new Error("Remove child branches first. Only leaf branch nodes can be removed.");
                }
              }
              const items = connection.items
                .filter((item) => item.todo_id !== todoId)
                .map((item, index) => ({ ...item, position: index }));
              return {
                ...connection,
                items,
                progress: buildConnectionProgress(connection.kind, items),
                is_fully_complete: items.length > 0 && items.every((item) => item.is_completed === 1),
              };
            })
            .filter((connection) => connection.items.length >= 2);
        });
      },
      async () => {
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections
            .map((connection) => {
              if (connection.id !== connectionId) return connection;
              if (connection.kind === "branch") {
                const target = connection.items.find((item) => item.todo_id === todoId);
                if (!target) throw new Error("Task is not part of this connection.");
                if (getEffectiveBranchParentTodoId(connection.items, target) == null) {
                  throw new Error("Cannot remove the root of a branch tree.");
                }
                if (connection.items.some((item) => getEffectiveBranchParentTodoId(connection.items, item) === todoId)) {
                  throw new Error("Remove child branches first. Only leaf branch nodes can be removed.");
                }
              }
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
        await mutateSnapshot((draft) => {
          draft.connections = draft.connections.filter((connection) => connection.id !== id);
        });
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
    if (error) {
      if (isMissingColumnOrRelationError(error)) {
        console.warn("Live sync trash groups are unavailable; using local trash snapshot only.", error);
        return buildTrashPayload(snapshot);
      }
      throw error;
    }

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
