import { Hono } from "hono";
import { eq, inArray, isNull, and, sql } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { groups, todos } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

/**
 * Creates the batch operations router for todos.
 * Endpoints:
 * - POST /api/todos/batch/complete - Mark multiple todos as completed
 * - POST /api/todos/batch/delete - Soft-delete multiple todos
 * - POST /api/todos/batch/move - Move multiple todos to another group
 */
export function createBatchRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // POST /api/todos/batch/complete — Mark multiple todos as completed
  router.post("/complete", async (c) => {
    try {
      const body = await c.req.json();
      const { ids } = body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return c.json({ error: "ids must be a non-empty array of todo IDs" }, 400);
      }

      // Validate all ids are strings
      for (const id of ids) {
        if (typeof id !== "string") {
          return c.json({ error: "All ids must be strings" }, 400);
        }
      }

      const { db: drizzleDb, sqlite } = db();
      const now = new Date().toISOString();
      const skippedIds: string[] = [];
      let affectedCount = 0;

      // Run in a transaction
      const transaction = sqlite.transaction(() => {
        for (const id of ids) {
          // Find the todo (only non-deleted todos can be completed)
          const todo = drizzleDb
            .select()
            .from(todos)
            .where(eq(todos.id, id))
            .get();

          if (!todo || todo.deleted_at !== null) {
            skippedIds.push(id);
            continue;
          }

          // Mark as completed
          drizzleDb
            .update(todos)
            .set({
              is_completed: 1,
              completed_at: todo.is_completed === 1 ? (todo.completed_at ?? now) : now,
              updated_at: now,
            })
            .where(eq(todos.id, id))
            .run();

          affectedCount++;
        }
      });
      transaction();

      return c.json({
        data: {
          affected: affectedCount,
          skipped: skippedIds,
        },
      });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/todos/batch/delete — Soft-delete multiple todos
  router.post("/delete", async (c) => {
    try {
      const body = await c.req.json();
      const { ids } = body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return c.json({ error: "ids must be a non-empty array of todo IDs" }, 400);
      }

      // Validate all ids are strings
      for (const id of ids) {
        if (typeof id !== "string") {
          return c.json({ error: "All ids must be strings" }, 400);
        }
      }

      const { db: drizzleDb, sqlite } = db();
      const now = new Date().toISOString();
      const skippedIds: string[] = [];
      let affectedCount = 0;

      // Run in a transaction
      const transaction = sqlite.transaction(() => {
        for (const id of ids) {
          // Find the todo
          const todo = drizzleDb
            .select()
            .from(todos)
            .where(eq(todos.id, id))
            .get();

          // Skip if todo doesn't exist or is already deleted
          if (!todo || todo.deleted_at !== null) {
            skippedIds.push(id);
            continue;
          }

          // Soft-delete
          drizzleDb
            .update(todos)
            .set({ deleted_at: now, updated_at: now })
            .where(eq(todos.id, id))
            .run();

          affectedCount++;
        }
      });
      transaction();

      return c.json({
        data: {
          affected: affectedCount,
          skipped: skippedIds,
        },
      });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/todos/batch/move — Move multiple todos to another group
  router.post("/move", async (c) => {
    try {
      const body = await c.req.json();
      const { ids, targetGroupId } = body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return c.json({ error: "ids must be a non-empty array of todo IDs" }, 400);
      }

      // Validate all ids are strings
      for (const id of ids) {
        if (typeof id !== "string") {
          return c.json({ error: "All ids must be strings" }, 400);
        }
      }

      if (!targetGroupId || typeof targetGroupId !== "string") {
        return c.json({ error: "targetGroupId is required and must be a string" }, 400);
      }

      const { db: drizzleDb, sqlite } = db();

      // Check if target group exists
      const targetGroup = drizzleDb
        .select()
        .from(groups)
        .where(and(eq(groups.id, targetGroupId), isNull(groups.deleted_at)))
        .get();

      if (!targetGroup) {
        return c.json({ error: "Target group not found" }, 404);
      }

      const now = new Date().toISOString();
      const skippedIds: string[] = [];
      let affectedCount = 0;

      // Run in a transaction
      const transaction = sqlite.transaction(() => {
        const maxPosResult = drizzleDb
          .select({
            maxPos: sql<number>`COALESCE(MAX(${todos.position}), -1)`,
          })
          .from(todos)
          .where(and(eq(todos.group_id, targetGroupId), isNull(todos.deleted_at)))
          .get();
        let nextPosition = (maxPosResult?.maxPos ?? -1) + 1;

        for (const id of ids) {
          // Find the todo (only non-deleted todos can be moved)
          const todo = drizzleDb
            .select()
            .from(todos)
            .where(eq(todos.id, id))
            .get();

          if (!todo || todo.deleted_at !== null) {
            skippedIds.push(id);
            continue;
          }

          // Move to target group (update group_id and updated_at)
          drizzleDb
            .update(todos)
            .set({ group_id: targetGroupId, position: nextPosition, updated_at: now })
            .where(eq(todos.id, id))
            .run();

          nextPosition += 1;
          affectedCount++;
        }
      });
      transaction();

      return c.json({
        data: {
          affected: affectedCount,
          skipped: skippedIds,
        },
      });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}
