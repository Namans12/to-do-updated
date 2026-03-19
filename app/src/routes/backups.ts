import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { activityLogs, connectionItems, connections, groups, todos } from "../db/schema.js";
import { logActivity } from "../lib/activity.js";
import fs from "fs";
import path from "path";

type DbOverride = ReturnType<typeof getDb>;

interface BackupFilePayload {
  id: string;
  label: string;
  created_at: string;
  counts: {
    groups: number;
    todos: number;
    connections: number;
    connection_items: number;
    activity_logs: number;
  };
  snapshot: {
    groups: typeof groups.$inferSelect[];
    todos: typeof todos.$inferSelect[];
    connections: typeof connections.$inferSelect[];
    connection_items: typeof connectionItems.$inferSelect[];
    activity_logs: typeof activityLogs.$inferSelect[];
  };
}

function attachParentTitle(
  todo: typeof todos.$inferSelect | null,
  _lookup: Map<string, typeof todos.$inferSelect>
) {
  if (!todo) return null;
  return todo;
}

function findTodoInBackup(payload: BackupFilePayload, todoId: string) {
  return payload.snapshot.todos.find((todo) => todo.id === todoId) ?? null;
}

function backupsDir() {
  return path.join(process.cwd(), "data", "backups");
}

function ensureBackupsDir() {
  const dir = backupsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function backupPath(backupId: string) {
  return path.join(ensureBackupsDir(), `${backupId}.json`);
}

function readBackupFiles() {
  const dir = ensureBackupsDir();
  const parsed: BackupFilePayload[] = [];
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
    const fullPath = path.join(dir, name);
    try {
      const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as Partial<BackupFilePayload>;
      if (
        typeof payload?.id !== "string" ||
        typeof payload?.created_at !== "string" ||
        typeof payload?.label !== "string"
      ) {
        console.warn(`[backups] Skipping malformed backup file: ${name}`);
        continue;
      }
      parsed.push(payload as BackupFilePayload);
    } catch (error) {
      console.warn(
        `[backups] Failed to parse backup file: ${name}`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return parsed.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createBackupsRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  router.get("/", (c) => {
    const data = readBackupFiles().map((backup) => ({
      id: backup.id,
      label: backup.label,
      created_at: backup.created_at,
      counts: backup.counts,
    }));
    return c.json({ data });
  });

  router.post("/", async (c) => {
    const { db: drizzleDb } = db();
    const body = await c.req.json().catch(() => ({}));
    const label =
      typeof body?.label === "string" && body.label.trim().length > 0
        ? body.label.trim()
        : `Snapshot ${new Date().toLocaleString("en-CA")}`;
    const backupId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const snapshot: BackupFilePayload = {
      id: backupId,
      label,
      created_at: createdAt,
      counts: {
        groups: 0,
        todos: 0,
        connections: 0,
        connection_items: 0,
        activity_logs: 0,
      },
      snapshot: {
        groups: drizzleDb.select().from(groups).all(),
        todos: drizzleDb.select().from(todos).all(),
        connections: drizzleDb.select().from(connections).all(),
        connection_items: drizzleDb.select().from(connectionItems).all(),
        activity_logs: drizzleDb.select().from(activityLogs).all(),
      },
    };

    snapshot.counts = {
      groups: snapshot.snapshot.groups.length,
      todos: snapshot.snapshot.todos.length,
      connections: snapshot.snapshot.connections.length,
      connection_items: snapshot.snapshot.connection_items.length,
      activity_logs: snapshot.snapshot.activity_logs.length,
    };

    fs.writeFileSync(backupPath(backupId), JSON.stringify(snapshot, null, 2), "utf8");
    logActivity(drizzleDb, {
      entity_type: "backup",
      entity_id: backupId,
      action: "created",
      summary: `Created backup snapshot "${label}"`,
      payload: snapshot.counts,
    });

    return c.json({
      data: {
        id: backupId,
        label,
        created_at: createdAt,
        counts: snapshot.counts,
      },
    }, 201);
  });

  router.post("/:id/restore", (c) => {
    const backupId = c.req.param("id");
    const fullPath = backupPath(backupId);
    if (!fs.existsSync(fullPath)) {
      return c.json({ error: "Backup not found" }, 404);
    }

    const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as BackupFilePayload;
    const { db: drizzleDb, sqlite } = db();

    const transaction = sqlite.transaction(() => {
      drizzleDb.delete(connectionItems).run();
      drizzleDb.delete(connections).run();
      drizzleDb.delete(activityLogs).run();
      drizzleDb.delete(todos).run();
      drizzleDb.delete(groups).run();

      if (payload.snapshot.groups.length > 0) {
        drizzleDb.insert(groups).values(payload.snapshot.groups).run();
      }
      if (payload.snapshot.todos.length > 0) {
        drizzleDb.insert(todos).values(payload.snapshot.todos).run();
      }
      if (payload.snapshot.connections.length > 0) {
        drizzleDb.insert(connections).values(payload.snapshot.connections).run();
      }
      if (payload.snapshot.connection_items.length > 0) {
        drizzleDb.insert(connectionItems).values(payload.snapshot.connection_items).run();
      }
      if (payload.snapshot.activity_logs.length > 0) {
        drizzleDb.insert(activityLogs).values(payload.snapshot.activity_logs).run();
      }
    });
    transaction();

    logActivity(drizzleDb, {
      entity_type: "backup",
      entity_id: backupId,
      action: "restored",
      summary: `Restored backup snapshot "${payload.label}"`,
      payload: payload.counts,
    });

    return c.json({
      data: {
        id: payload.id,
        label: payload.label,
        created_at: payload.created_at,
        counts: payload.counts,
      },
    });
  });

  router.get("/:id/todos/:todoId", (c) => {
    const backupId = c.req.param("id");
    const todoId = c.req.param("todoId");
    const fullPath = backupPath(backupId);
    if (!fs.existsSync(fullPath)) {
      return c.json({ error: "Backup not found" }, 404);
    }

    const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as BackupFilePayload;
    const todo = findTodoInBackup(payload, todoId);
    if (!todo) {
      return c.json({ error: "Task not found in backup" }, 404);
    }

    const currentRows = db().db.select().from(todos).all();
    const currentLookup = new Map(currentRows.map((row) => [row.id, row]));
    const backupLookup = new Map(payload.snapshot.todos.map((row) => [row.id, row]));
    const current = currentLookup.get(todoId) ?? null;
    return c.json({
      data: {
        backup: attachParentTitle(todo, backupLookup),
        current: attachParentTitle(current, currentLookup),
      },
    });
  });

  router.post("/:id/todos/:todoId/restore", (c) => {
    const backupId = c.req.param("id");
    const todoId = c.req.param("todoId");
    const fullPath = backupPath(backupId);
    if (!fs.existsSync(fullPath)) {
      return c.json({ error: "Backup not found" }, 404);
    }

    const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as BackupFilePayload;
    const todo = findTodoInBackup(payload, todoId);
    if (!todo) {
      return c.json({ error: "Task not found in backup" }, 404);
    }

    const { db: drizzleDb } = db();
    const current = drizzleDb.select().from(todos).where(eq(todos.id, todoId)).get();

    if (current) {
      drizzleDb.update(todos).set(todo).where(eq(todos.id, todoId)).run();
    } else {
      drizzleDb.insert(todos).values(todo).run();
    }

    const restored = drizzleDb.select().from(todos).where(eq(todos.id, todoId)).get();
    logActivity(drizzleDb, {
      entity_type: "todo",
      entity_id: todoId,
      action: "restored_from_backup",
      summary: `Restored task "${todo.title}" from backup`,
      payload: {
        backup_id: backupId,
        replaced_existing: !!current,
        before: attachParentTitle(current ?? null, new Map(drizzleDb.select().from(todos).all().map((row) => [row.id, row]))),
        after: attachParentTitle(restored ?? null, new Map(drizzleDb.select().from(todos).all().map((row) => [row.id, row]))),
      },
    });

    return c.json({ data: restored });
  });

  router.delete("/:id", (c) => {
    const backupId = c.req.param("id");
    const fullPath = backupPath(backupId);
    if (!fs.existsSync(fullPath)) {
      return c.json({ error: "Backup not found" }, 404);
    }

    const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as BackupFilePayload;
    fs.unlinkSync(fullPath);
    const { db: drizzleDb } = db();
    logActivity(drizzleDb, {
      entity_type: "backup",
      entity_id: backupId,
      action: "deleted",
      summary: `Deleted backup snapshot "${payload.label}"`,
    });

    return c.json({ data: { message: "Backup deleted successfully" } });
  });

  return router;
}
