import { Hono } from "hono";
import { getDb } from "../db/connection.js";
import { activityLogs, connectionItems, connections, groups, todos } from "../db/schema.js";
import { logActivity } from "../lib/activity.js";

type DbOverride = ReturnType<typeof getDb>;

interface SyncPayload {
  version: 1;
  exported_at: string;
  device_name: string | null;
  snapshot: {
    groups: typeof groups.$inferSelect[];
    todos: typeof todos.$inferSelect[];
    connections: typeof connections.$inferSelect[];
    connection_items: typeof connectionItems.$inferSelect[];
    activity_logs: typeof activityLogs.$inferSelect[];
  };
}

function parseSyncPayload(input: unknown): SyncPayload | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<SyncPayload>;
  if (candidate.version !== 1 || !candidate.snapshot) return null;
  const snapshot = candidate.snapshot as SyncPayload["snapshot"];
  if (
    !Array.isArray(snapshot.groups) ||
    !Array.isArray(snapshot.todos) ||
    !Array.isArray(snapshot.connections) ||
    !Array.isArray(snapshot.connection_items) ||
    !Array.isArray(snapshot.activity_logs)
  ) {
    return null;
  }
  return {
    version: 1,
    exported_at:
      typeof candidate.exported_at === "string"
        ? candidate.exported_at
        : new Date().toISOString(),
    device_name:
      typeof candidate.device_name === "string" && candidate.device_name.trim().length > 0
        ? candidate.device_name.trim()
        : null,
    snapshot,
  };
}

export function createSyncRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  router.get("/export", (c) => {
    const { db: drizzleDb } = db();
    const deviceName = c.req.query("device_name")?.trim() || null;
    const payload: SyncPayload = {
      version: 1,
      exported_at: new Date().toISOString(),
      device_name: deviceName,
      snapshot: {
        groups: drizzleDb.select().from(groups).all(),
        todos: drizzleDb.select().from(todos).all(),
        connections: drizzleDb.select().from(connections).all(),
        connection_items: drizzleDb.select().from(connectionItems).all(),
        activity_logs: drizzleDb.select().from(activityLogs).all(),
      },
    };

    logActivity(drizzleDb, {
      entity_type: "sync",
      entity_id: payload.exported_at,
      action: "exported",
      summary: `Exported sync package${deviceName ? ` for ${deviceName}` : ""}`,
      payload: {
        device_name: deviceName,
        groups: payload.snapshot.groups.length,
        todos: payload.snapshot.todos.length,
        connections: payload.snapshot.connections.length,
      },
    });

    return c.json({ data: payload });
  });

  router.post("/import", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseSyncPayload(body);
    if (!parsed) {
      return c.json({ error: "Invalid sync package" }, 400);
    }

    const { db: drizzleDb, sqlite } = db();
    const transaction = sqlite.transaction(() => {
      drizzleDb.delete(connectionItems).run();
      drizzleDb.delete(connections).run();
      drizzleDb.delete(activityLogs).run();
      drizzleDb.delete(todos).run();
      drizzleDb.delete(groups).run();

      if (parsed.snapshot.groups.length > 0) {
        drizzleDb.insert(groups).values(parsed.snapshot.groups).run();
      }
      if (parsed.snapshot.todos.length > 0) {
        drizzleDb.insert(todos).values(parsed.snapshot.todos).run();
      }
      if (parsed.snapshot.connections.length > 0) {
        drizzleDb.insert(connections).values(parsed.snapshot.connections).run();
      }
      if (parsed.snapshot.connection_items.length > 0) {
        drizzleDb.insert(connectionItems).values(parsed.snapshot.connection_items).run();
      }
      if (parsed.snapshot.activity_logs.length > 0) {
        drizzleDb.insert(activityLogs).values(parsed.snapshot.activity_logs).run();
      }
    });
    transaction();

    logActivity(drizzleDb, {
      entity_type: "sync",
      entity_id: parsed.exported_at,
      action: "imported",
      summary: `Imported sync package${parsed.device_name ? ` from ${parsed.device_name}` : ""}`,
      payload: {
        device_name: parsed.device_name,
        exported_at: parsed.exported_at,
        groups: parsed.snapshot.groups.length,
        todos: parsed.snapshot.todos.length,
        connections: parsed.snapshot.connections.length,
      },
    });

    return c.json({
      data: {
        version: parsed.version,
        exported_at: parsed.exported_at,
        device_name: parsed.device_name,
        counts: {
          groups: parsed.snapshot.groups.length,
          todos: parsed.snapshot.todos.length,
          connections: parsed.snapshot.connections.length,
          connection_items: parsed.snapshot.connection_items.length,
          activity_logs: parsed.snapshot.activity_logs.length,
        },
      },
    });
  });

  return router;
}
