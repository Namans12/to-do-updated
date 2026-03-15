import { openDB } from "idb";
import type { ActivityLog, Connection, Group, Todo } from "../types";

export interface SyncCacheSnapshot {
  groups: Group[];
  todos: Todo[];
  connections: Connection[];
  activity: ActivityLog[];
  lastSyncedAt: string | null;
}

export interface PendingOperation {
  id: string;
  kind:
    | "group.create"
    | "group.update"
    | "group.delete"
    | "group.reorder"
    | "todo.create"
    | "todo.update"
    | "todo.toggleComplete"
    | "todo.delete"
    | "todo.reorder"
    | "todo.ackReminder"
    | "connection.create"
    | "connection.update"
    | "connection.addItem"
    | "connection.merge"
    | "connection.cut"
    | "connection.reorderItems"
    | "connection.removeItem"
    | "connection.delete";
  payload: Record<string, unknown>;
  createdAt: string;
}

interface SyncDbSchema {
  docs: {
    key: string;
    value: {
      key: string;
      value: unknown;
    };
  };
  queue: {
    key: string;
    value: PendingOperation;
  };
}

const DB_NAME = "nodes-sync";
const DOCS_STORE = "docs";
const QUEUE_STORE = "queue";
const SNAPSHOT_KEY = "snapshot";

async function getDb() {
  return openDB<SyncDbSchema>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(DOCS_STORE)) {
        db.createObjectStore(DOCS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    },
  });
}

export async function readSyncSnapshot(): Promise<SyncCacheSnapshot> {
  const db = await getDb();
  const record = await db.get(DOCS_STORE, SNAPSHOT_KEY);
  if (!record?.value) {
    return {
      groups: [],
      todos: [],
      connections: [],
      activity: [],
      lastSyncedAt: null,
    };
  }
  return record.value as SyncCacheSnapshot;
}

export async function writeSyncSnapshot(snapshot: SyncCacheSnapshot) {
  const db = await getDb();
  await db.put(DOCS_STORE, {
    key: SNAPSHOT_KEY,
    value: snapshot,
  });
}

export async function readPendingOperations() {
  const db = await getDb();
  return db.getAll(QUEUE_STORE);
}

export async function writePendingOperation(operation: PendingOperation) {
  const db = await getDb();
  await db.put(QUEUE_STORE, operation);
}

export async function deletePendingOperation(id: string) {
  const db = await getDb();
  await db.delete(QUEUE_STORE, id);
}
