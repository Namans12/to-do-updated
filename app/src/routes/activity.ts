import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { activityLogs } from "../db/schema.js";

type DbOverride = ReturnType<typeof getDb>;

export function createActivityRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  router.get("/", (c) => {
    const limitParam = Number(c.req.query("limit") ?? "50");
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(Math.trunc(limitParam), 1), 200)
      : 50;

    const { db: drizzleDb } = db();
    const entries = drizzleDb
      .select()
      .from(activityLogs)
      .orderBy(desc(activityLogs.created_at))
      .limit(limit)
      .all()
      .map((entry) => ({
        ...entry,
        payload: entry.payload_json ? safeParse(entry.payload_json) : null,
      }));

    return c.json({ data: entries });
  });

  return router;
}

function safeParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
