import { Hono } from "hono";
import { eq, isNotNull, sql, inArray } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { todos, connectionItems, connections, groups } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

/**
 * Creates the trash router for managing soft-deleted todos.
 * Routes:
 *   GET    /api/trash              — List all soft-deleted todos with remaining days
 *   POST   /api/trash/groups/:id/restore  — Restore a soft-deleted group with its todos
 *   DELETE /api/trash/groups/:id          — Permanently delete a soft-deleted group with its todos
 *   POST   /api/trash/:id/restore  — Restore a soft-deleted todo
 *   DELETE /api/trash/:id          — Permanently delete a single todo
 *   DELETE /api/trash              — Empty entire trash permanently
 */
export function createTrashRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // GET /api/trash — List all soft-deleted todos with remaining days until purge
  router.get("/", async (c) => {
    try {
      const { db: drizzleDb } = db();

      const deletedTodos = drizzleDb
        .select()
        .from(todos)
        .where(isNotNull(todos.deleted_at))
        .all();

      const deletedGroups = drizzleDb
        .select({ id: groups.id, name: groups.name, deleted_at: groups.deleted_at })
        .from(groups)
        .where(isNotNull(groups.deleted_at))
        .all();

      const groupIds = [...new Set(deletedTodos.map((todo) => todo.group_id))];
      const groupRows = groupIds.length > 0
        ? drizzleDb
          .select({ id: groups.id, name: groups.name, deleted_at: groups.deleted_at })
          .from(groups)
          .where(inArray(groups.id, groupIds))
          .all()
        : [];
      const groupMetaMap = new Map(
        groupRows.map((group) => [
          group.id,
          {
            name: group.name,
            deleted_at: group.deleted_at,
          },
        ])
      );

      const now = new Date();
      const PURGE_DAYS = 30;

      const result = deletedTodos.map((todo) => {
        const deletedAt = new Date(todo.deleted_at!);
        const msElapsed = now.getTime() - deletedAt.getTime();
        const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.max(0, Math.ceil(PURGE_DAYS - daysElapsed));

        return {
          ...todo,
          group_name: groupMetaMap.get(todo.group_id)?.name ?? "Unknown group",
          group_deleted: !!groupMetaMap.get(todo.group_id)?.deleted_at,
          group_deleted_at: groupMetaMap.get(todo.group_id)?.deleted_at ?? null,
          days_until_purge: daysRemaining,
        };
      });

      return c.json({
        data: {
          todos: result,
          groups: deletedGroups,
        },
      });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/trash/groups/:id/restore — Restore a soft-deleted group and all its todos
  router.post("/groups/:id/restore", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      const group = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      if (!group.deleted_at) {
        return c.json({ error: "Group is not in trash" }, 400);
      }

      const now = new Date().toISOString();
      let restoredCount = 0;

      const transaction = sqlite.transaction(() => {
        drizzleDb
          .update(groups)
          .set({ deleted_at: null, updated_at: now })
          .where(eq(groups.id, id))
          .run();

        const result = drizzleDb
          .update(todos)
          .set({ deleted_at: null, updated_at: now })
          .where(sql`${todos.group_id} = ${id} AND ${todos.deleted_at} IS NOT NULL`)
          .run();
        restoredCount = result.changes ?? 0;
      });
      transaction();

      return c.json({
        data: {
          message: "Group restored successfully",
          restored_count: restoredCount,
        },
      });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/trash/groups/:id — Permanently delete a soft-deleted group and all its todos
  router.delete("/groups/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      const group = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      if (!group.deleted_at) {
        return c.json({ error: "Group is not in trash" }, 400);
      }

      const groupTodos = drizzleDb
        .select({ id: todos.id })
        .from(todos)
        .where(eq(todos.group_id, id))
        .all();
      const todoIds = groupTodos.map((t) => t.id);

      const transaction = sqlite.transaction(() => {
        if (todoIds.length > 0) {
          drizzleDb
            .delete(connectionItems)
            .where(inArray(connectionItems.todo_id, todoIds))
            .run();

          const stillUsed = drizzleDb
            .select({ connId: connectionItems.connection_id })
            .from(connectionItems)
            .all();
          const stillUsedIds = [...new Set(stillUsed.map((r) => r.connId))];
          const allConns = drizzleDb
            .select({ id: connections.id })
            .from(connections)
            .all();
          const orphanedIds = allConns
            .filter((c) => !stillUsedIds.includes(c.id))
            .map((c) => c.id);
          if (orphanedIds.length > 0) {
            drizzleDb
              .delete(connections)
              .where(inArray(connections.id, orphanedIds))
              .run();
          }
        }

        drizzleDb
          .delete(todos)
          .where(eq(todos.group_id, id))
          .run();

        drizzleDb
          .delete(groups)
          .where(eq(groups.id, id))
          .run();
      });
      transaction();

      return c.json({
        data: {
          message: "Group permanently deleted",
          deleted_todo_count: todoIds.length,
        },
      });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/trash/:id/restore — Restore a soft-deleted todo
  router.post("/:id/restore", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb } = db();

      // Find the todo
      const todo = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      if (!todo) {
        return c.json({ error: "Todo not found" }, 404);
      }

      if (!todo.deleted_at) {
        return c.json({ error: "Todo is not in trash" }, 400);
      }

      const now = new Date().toISOString();
      const parentGroup = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, todo.group_id))
        .get();

      if (parentGroup?.deleted_at) {
        drizzleDb
          .update(groups)
          .set({ deleted_at: null, updated_at: now })
          .where(eq(groups.id, parentGroup.id))
          .run();
      }

      drizzleDb
        .update(todos)
        .set({ deleted_at: null, updated_at: now })
        .where(eq(todos.id, id))
        .run();

      const restored = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      return c.json({ data: restored });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/trash/:id — Permanently delete a single todo from trash
  router.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      // Find the todo
      const todo = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      if (!todo) {
        return c.json({ error: "Todo not found" }, 404);
      }

      if (!todo.deleted_at) {
        return c.json({ error: "Todo is not in trash. Use DELETE /api/todos/:id to soft-delete first." }, 400);
      }

      // Run in a transaction: remove connection_items referencing this todo,
      // clean up now-empty connections, then hard-delete the todo
      const transaction = sqlite.transaction(() => {
        // Remove any connection_items referencing this todo
        drizzleDb
          .delete(connectionItems)
          .where(eq(connectionItems.todo_id, id))
          .run();

        // Delete any connections that now have zero items
        const stillUsed = drizzleDb
          .select({ connId: connectionItems.connection_id })
          .from(connectionItems)
          .all();
        const stillUsedIds = [...new Set(stillUsed.map((r) => r.connId))];
        const allConns = drizzleDb
          .select({ id: connections.id })
          .from(connections)
          .all();
        const orphanedIds = allConns
          .filter((c) => !stillUsedIds.includes(c.id))
          .map((c) => c.id);
        if (orphanedIds.length > 0) {
          drizzleDb
            .delete(connections)
            .where(inArray(connections.id, orphanedIds))
            .run();
        }

        // Hard-delete the todo
        drizzleDb
          .delete(todos)
          .where(eq(todos.id, id))
          .run();
      });
      transaction();

      return c.json({ data: { message: "Todo permanently deleted" } });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/trash — Empty entire trash permanently
  router.delete("/", async (c) => {
    try {
      const { db: drizzleDb, sqlite } = db();

      // Get all soft-deleted todo IDs
      const trashedTodos = drizzleDb
        .select({ id: todos.id })
        .from(todos)
        .where(isNotNull(todos.deleted_at))
        .all();
      const trashedGroups = drizzleDb
        .select({ id: groups.id })
        .from(groups)
        .where(isNotNull(groups.deleted_at))
        .all();

      if (trashedTodos.length === 0 && trashedGroups.length === 0) {
        return c.json({ data: { message: "Trash is already empty", deleted_count: 0 } });
      }

      const transaction = sqlite.transaction(() => {
        // Remove connection_items referencing trashed todos
        for (const todo of trashedTodos) {
          drizzleDb
            .delete(connectionItems)
            .where(eq(connectionItems.todo_id, todo.id))
            .run();
        }

        // Delete any connections that now have zero items
        const stillUsed = drizzleDb
          .select({ connId: connectionItems.connection_id })
          .from(connectionItems)
          .all();
        const stillUsedIds = [...new Set(stillUsed.map((r) => r.connId))];
        const allConns = drizzleDb
          .select({ id: connections.id })
          .from(connections)
          .all();
        const orphanedIds = allConns
          .filter((c) => !stillUsedIds.includes(c.id))
          .map((c) => c.id);
        if (orphanedIds.length > 0) {
          drizzleDb
            .delete(connections)
            .where(inArray(connections.id, orphanedIds))
            .run();
        }

        // Hard-delete all soft-deleted todos
        drizzleDb
          .delete(todos)
          .where(isNotNull(todos.deleted_at))
          .run();

        // Remove groups that are in trash and have no remaining todos.
        for (const group of trashedGroups) {
          const remaining = drizzleDb
            .select({ count: sql<number>`COUNT(*)` })
            .from(todos)
            .where(eq(todos.group_id, group.id))
            .get();
          if ((remaining?.count ?? 0) === 0) {
            drizzleDb
              .delete(groups)
              .where(eq(groups.id, group.id))
              .run();
          }
        }
      });
      transaction();

      // Run VACUUM to reclaim space after bulk delete
      sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      sqlite.exec("VACUUM");

      return c.json({
        data: {
          message: "Trash emptied successfully",
          deleted_count: trashedTodos.length + trashedGroups.length,
        },
      });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}

/**
 * Auto-purge: permanently deletes todos that have been in trash for more than 30 days.
 * Also cleans up orphaned connection_items and runs VACUUM.
 *
 * @param dbOverride - Optional DB override for testing
 * @returns The number of purged todos
 */
export function runAutoPurge(dbOverride?: DbOverride): number {
  const { db: drizzleDb, sqlite } = dbOverride ?? getDb();

  // Find todos with deleted_at older than 30 days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoffIso = cutoffDate.toISOString();

  const expiredTodos = drizzleDb
    .select({ id: todos.id })
    .from(todos)
    .where(
      sql`${todos.deleted_at} IS NOT NULL AND ${todos.deleted_at} < ${cutoffIso}`
    )
    .all();

  if (expiredTodos.length === 0) {
    return 0;
  }

  const transaction = sqlite.transaction(() => {
    // Remove connection_items referencing expired todos
    for (const todo of expiredTodos) {
      drizzleDb
        .delete(connectionItems)
        .where(eq(connectionItems.todo_id, todo.id))
        .run();
    }

    // Delete any connections that now have zero items
    const stillUsed = drizzleDb
      .select({ connId: connectionItems.connection_id })
      .from(connectionItems)
      .all();
    const stillUsedIds = [...new Set(stillUsed.map((r) => r.connId))];
    const allConns = drizzleDb
      .select({ id: connections.id })
      .from(connections)
      .all();
    const orphanedIds = allConns
      .filter((c) => !stillUsedIds.includes(c.id))
      .map((c) => c.id);
    if (orphanedIds.length > 0) {
      drizzleDb
        .delete(connections)
        .where(inArray(connections.id, orphanedIds))
        .run();
    }

    // Hard-delete all expired todos
    for (const todo of expiredTodos) {
      drizzleDb
        .delete(todos)
        .where(eq(todos.id, todo.id))
        .run();
    }

    // Clean up any soft-deleted groups that no longer have todos.
    const deletedGroups = drizzleDb
      .select({ id: groups.id })
      .from(groups)
      .where(isNotNull(groups.deleted_at))
      .all();

    for (const group of deletedGroups) {
      const remaining = drizzleDb
        .select({ count: sql<number>`COUNT(*)` })
        .from(todos)
        .where(eq(todos.group_id, group.id))
        .get();
      if ((remaining?.count ?? 0) === 0) {
        drizzleDb
          .delete(groups)
          .where(eq(groups.id, group.id))
          .run();
      }
    }
  });
  transaction();

  // WAL checkpoint and VACUUM to reclaim space
  sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  sqlite.exec("VACUUM");

  return expiredTodos.length;
}

/**
 * Starts the auto-purge scheduler.
 * Runs once immediately and then every 6 hours.
 *
 * @param dbOverride - Optional DB override for testing
 * @returns The interval ID (for cleanup on shutdown)
 */
export function startAutoPurgeScheduler(dbOverride?: DbOverride): NodeJS.Timeout {
  // Run immediately on startup
  try {
    const purgedCount = runAutoPurge(dbOverride);
    if (purgedCount > 0) {
      console.log(`Auto-purge: permanently deleted ${purgedCount} expired todo(s)`);
    }
  } catch (error) {
    console.error("Auto-purge startup error:", error);
  }

  // Run every 6 hours (21,600,000 ms)
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const intervalId = setInterval(() => {
    try {
      const purgedCount = runAutoPurge(dbOverride);
      if (purgedCount > 0) {
        console.log(`Auto-purge: permanently deleted ${purgedCount} expired todo(s)`);
      }
    } catch (error) {
      console.error("Auto-purge periodic error:", error);
    }
  }, SIX_HOURS);

  return intervalId;
}
