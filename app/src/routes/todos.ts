import { Hono } from "hono";
import { eq, and, asc, sql, isNull, ne, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { groups, todos } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

/**
 * Auto-capitalize the first character of a string.
 */
function autoCapitalize(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function parseReminderAt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/**
 * Creates the todos router with two sub-routers:
 * - Group-scoped routes: /api/groups/:groupId/todos
 * - Direct todo routes: /api/todos/:id, /api/todos/reorder
 */
export function createGroupTodosRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // POST /api/groups/:groupId/todos — Create a to-do in a group
  router.post("/", async (c) => {
    try {
      const groupId = c.req.param("groupId");
      if (!groupId) {
        return c.json({ error: "Group ID is required" }, 400);
      }
      const body = await c.req.json();
      const { title, description, high_priority, reminder_at } = body;

      const { db: drizzleDb, sqlite } = db();

      // Validate group exists
      const group = drizzleDb
        .select()
        .from(groups)
        .where(and(eq(groups.id, groupId), isNull(groups.deleted_at)))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      // Validate title
      if (!title || typeof title !== "string" || title.trim().length === 0) {
        return c.json({ error: "Title is required and must be a non-empty string" }, 400);
      }

      if (title.trim().length > 500) {
        return c.json({ error: "Title must be at most 500 characters" }, 400);
      }

      const trimmedTitle = autoCapitalize(title.trim());
      const normalizedTitle = trimmedTitle.toLowerCase();
      const trimmedDescription = description != null && typeof description === "string"
        ? description.trim() || null
        : null;
      if (
        high_priority !== undefined &&
        high_priority !== true &&
        high_priority !== false &&
        high_priority !== 1 &&
        high_priority !== 0
      ) {
        return c.json({ error: "high_priority must be a boolean or 0/1" }, 400);
      }
      const priorityValue = high_priority === true || high_priority === 1 ? 1 : 0;
      const parsedReminderAt = parseReminderAt(reminder_at);
      if (reminder_at !== undefined && parsedReminderAt === undefined) {
        return c.json({ error: "reminder_at must be a valid ISO date-time string or null" }, 400);
      }
      if (parsedReminderAt && new Date(parsedReminderAt).getTime() <= Date.now()) {
        return c.json({ error: "reminder_at must be in the future" }, 400);
      }

      // Check for duplicate title in the same group (case-insensitive, excluding deleted)
      const duplicate = drizzleDb
        .select()
        .from(todos)
        .where(
          and(
            eq(todos.group_id, groupId),
            isNull(todos.deleted_at),
            sql`LOWER(${todos.title}) = ${normalizedTitle}`
          )
        )
        .get();
      if (duplicate) {
        return c.json({ error: "A to-do with this title already exists in this group" }, 400);
      }

      const now = new Date().toISOString();
      const newTodo = {
        id: uuidv4(),
        group_id: groupId,
        title: trimmedTitle,
        description: trimmedDescription,
        high_priority: priorityValue,
        reminder_at: parsedReminderAt ?? null,
        is_completed: 0,
        completed_at: null,
        position: 0,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      };

      // Wrap position read + insert in a transaction for atomicity
      const transaction = sqlite.transaction(() => {
        const maxPosResult = drizzleDb
          .select({ maxPos: sql<number>`COALESCE(MAX(${todos.position}), -1)` })
          .from(todos)
          .where(and(eq(todos.group_id, groupId), isNull(todos.deleted_at)))
          .get();
        const nextPosition = (maxPosResult?.maxPos ?? -1) + 1;
        newTodo.position = nextPosition;

        drizzleDb.insert(todos).values(newTodo).run();
      });
      transaction();

      return c.json({ data: newTodo }, 201);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      if (
        typeof error?.message === "string" &&
        /unique|constraint/i.test(error.message)
      ) {
        return c.json({ error: "A to-do with this title already exists in this group" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/groups/:groupId/todos — List todos in a group (sorted by position)
  router.get("/", async (c) => {
    try {
      const groupId = c.req.param("groupId");
      if (!groupId) {
        return c.json({ error: "Group ID is required" }, 400);
      }
      const includeDeleted = c.req.query("include_deleted") === "true";
      const { db: drizzleDb } = db();

      // Validate group exists
      const group = drizzleDb
        .select()
        .from(groups)
        .where(and(eq(groups.id, groupId), isNull(groups.deleted_at)))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      let conditions = eq(todos.group_id, groupId);

      let results;
      if (includeDeleted) {
        results = drizzleDb
          .select()
          .from(todos)
          .where(conditions)
          .orderBy(asc(todos.position))
          .all();
      } else {
        results = drizzleDb
          .select()
          .from(todos)
          .where(and(conditions, isNull(todos.deleted_at)))
          .orderBy(asc(todos.position))
          .all();
      }

      return c.json({ data: results });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}

export function createTodosRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // PATCH /api/todos/reorder — Reorder todos within a group (must be before :id)
  router.patch("/reorder", async (c) => {
    try {
      const body = await c.req.json();
      const { items } = body;

      if (!Array.isArray(items) || items.length === 0) {
        return c.json({ error: "Items must be a non-empty array of { id, position }" }, 400);
      }

      // Validate each item has id and position
      for (const item of items) {
        if (
          !item.id ||
          typeof item.position !== "number" ||
          !Number.isInteger(item.position) ||
          item.position < 0
        ) {
          return c.json({ error: "Each item must have an id (string) and position (number)" }, 400);
        }
      }

      const { db: drizzleDb, sqlite } = db();
      const ids = items.map((item) => item.id);
      const positions = items.map((item) => item.position);

      if (new Set(ids).size !== ids.length) {
        return c.json({ error: "Duplicate todo ids are not allowed" }, 400);
      }

      if (new Set(positions).size !== positions.length) {
        return c.json({ error: "Duplicate positions are not allowed" }, 400);
      }

      const expectedPositions = [...positions].sort((a, b) => a - b);
      for (let i = 0; i < expectedPositions.length; i += 1) {
        if (expectedPositions[i] !== i) {
          return c.json(
            { error: "Positions must form a contiguous range starting at 0" },
            400
          );
        }
      }

      const selectedTodos = drizzleDb
        .select({
          id: todos.id,
          group_id: todos.group_id,
          high_priority: todos.high_priority,
        })
        .from(todos)
        .where(and(isNull(todos.deleted_at), eq(todos.is_completed, 0), inArray(todos.id, ids)))
        .all();

      if (selectedTodos.length !== ids.length) {
        return c.json(
          { error: "Reorder payload must include only incomplete active todos from one group" },
          400
        );
      }

      const groupIds = new Set(selectedTodos.map((todo) => todo.group_id));
      if (groupIds.size !== 1) {
        return c.json(
          { error: "Todos can only be reordered within a single group" },
          400
        );
      }

      const groupId = selectedTodos[0]!.group_id;
      const activeGroupTodos = drizzleDb
        .select({
          id: todos.id,
          high_priority: todos.high_priority,
        })
        .from(todos)
        .where(and(eq(todos.group_id, groupId), isNull(todos.deleted_at), eq(todos.is_completed, 0)))
        .all();

      if (activeGroupTodos.length !== ids.length) {
        return c.json(
          { error: "Reorder payload must include every incomplete active todo in the group exactly once" },
          400
        );
      }

      const activeIds = new Set(activeGroupTodos.map((todo) => todo.id));
      for (const id of ids) {
        if (!activeIds.has(id)) {
          return c.json(
            { error: "Reorder payload must include every incomplete active todo in the group exactly once" },
            400
          );
        }
      }

      const selectedById = new Map(selectedTodos.map((todo) => [todo.id, todo]));
      const reordered = [...items]
        .sort((a, b) => a.position - b.position)
        .map((item) => selectedById.get(item.id)!);
      let seenNormal = false;
      for (const todo of reordered) {
        if (todo.high_priority === 1) {
          if (seenNormal) {
            return c.json(
              { error: "High priority todos must stay above normal todos when reordering" },
              400
            );
          }
        } else {
          seenNormal = true;
        }
      }

      // Run in a transaction
      const transaction = sqlite.transaction(() => {
        const now = new Date().toISOString();
        for (const item of items) {
          drizzleDb
            .update(todos)
            .set({ position: item.position, updated_at: now })
            .where(eq(todos.id, item.id))
            .run();
        }
      });
      transaction();

      return c.json({ data: { message: "Todos reordered successfully" } });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      if (
        typeof error?.message === "string" &&
        /unique|constraint/i.test(error.message)
      ) {
        return c.json({ error: "A to-do with this title already exists in this group" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/todos/:id — Get a single to-do
  router.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb } = db();

      const todo = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      if (!todo) {
        return c.json({ error: "Todo not found" }, 404);
      }

      return c.json({ data: todo });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/todos/:id — Update title/description
  router.patch("/:id/complete", async (c) => {
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

      // Toggle completion status
      const newStatus = todo.is_completed === 1 ? 0 : 1;
      const now = new Date().toISOString();

      drizzleDb
        .update(todos)
        .set({
          is_completed: newStatus,
          completed_at: newStatus === 1 ? now : null,
          updated_at: now,
        })
        .where(eq(todos.id, id))
        .run();

      const updated = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      return c.json({ data: updated });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/todos/:id — Update title/description
  router.patch("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { title, description, high_priority, reminder_at } = body;

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

      // Build update object
      const updates: Record<string, any> = {};
      let normalizedTitle: string | null = null;
      const now = new Date().toISOString();
      updates.updated_at = now;

      if (title !== undefined) {
        if (typeof title !== "string" || title.trim().length === 0) {
          return c.json({ error: "Title must be a non-empty string" }, 400);
        }
        if (title.trim().length > 500) {
          return c.json({ error: "Title must be at most 500 characters" }, 400);
        }
        updates.title = autoCapitalize(title.trim());
        normalizedTitle = updates.title.toLowerCase();
      }

      if (description !== undefined) {
        if (description === null) {
          updates.description = null;
        } else if (typeof description === "string") {
          updates.description = description.trim() || null;
        } else {
          return c.json({ error: "Description must be a string or null" }, 400);
        }
      }

      if (high_priority !== undefined) {
        if (
          high_priority !== true &&
          high_priority !== false &&
          high_priority !== 1 &&
          high_priority !== 0
        ) {
          return c.json({ error: "high_priority must be a boolean or 0/1" }, 400);
        }
        updates.high_priority = high_priority === true || high_priority === 1 ? 1 : 0;
      }

      if (reminder_at !== undefined) {
        const parsedReminderAt = parseReminderAt(reminder_at);
        if (parsedReminderAt === undefined) {
          return c.json({ error: "reminder_at must be a valid ISO date-time string or null" }, 400);
        }
        if (parsedReminderAt && new Date(parsedReminderAt).getTime() <= Date.now()) {
          return c.json({ error: "reminder_at must be in the future" }, 400);
        }
        updates.reminder_at = parsedReminderAt;
      }

      if (normalizedTitle !== null) {
        const duplicate = drizzleDb
          .select()
          .from(todos)
          .where(
            and(
              eq(todos.group_id, todo.group_id),
              isNull(todos.deleted_at),
              ne(todos.id, id),
              sql`LOWER(${todos.title}) = ${normalizedTitle}`
            )
          )
          .get();
        if (duplicate) {
          return c.json({ error: "A to-do with this title already exists in this group" }, 400);
        }
      }

      drizzleDb
        .update(todos)
        .set(updates)
        .where(eq(todos.id, id))
        .run();

      const updated = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      return c.json({ data: updated });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/todos/:id — Soft-delete (set deleted_at)
  router.delete("/:id", async (c) => {
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

      if (todo.deleted_at) {
        return c.json({ error: "Todo is already deleted" }, 400);
      }

      const now = new Date().toISOString();
      drizzleDb
        .update(todos)
        .set({ deleted_at: now, updated_at: now })
        .where(eq(todos.id, id))
        .run();

      const updated = drizzleDb
        .select()
        .from(todos)
        .where(eq(todos.id, id))
        .get();

      return c.json({ data: updated });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}
