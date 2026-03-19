import { Hono } from "hono";
import { eq, asc, sql, and, isNull, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { groups, todos } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

function autoCapitalize(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function createGroupsRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // POST /api/groups — Create a group
  router.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { name } = body;

      // Validation
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return c.json({ error: "Name is required and must be a non-empty string" }, 400);
      }

      if (name.trim().length > 100) {
        return c.json({ error: "Name must be at most 100 characters" }, 400);
      }

      const trimmedName = autoCapitalize(name.trim());
      const { db: drizzleDb, sqlite } = db();

      const normalizedName = trimmedName.toLowerCase();
      // Check for duplicate name (case-insensitive, including trash)
      const existing = drizzleDb
        .select()
        .from(groups)
        .where(sql`LOWER(${groups.name}) = ${normalizedName}`)
        .get();

      if (existing) {
        return c.json(
          {
            error:
              "A group with this name already exists (including in Trash). Restore or permanently delete it first.",
          },
          400
        );
      }

      const now = new Date().toISOString();
      const newGroup = {
        id: uuidv4(),
        name: trimmedName,
        position: 0,
        created_at: now,
        updated_at: now,
      };

      // Wrap position read + insert in a transaction for atomicity
      const transaction = sqlite.transaction(() => {
        const maxPosResult = drizzleDb
          .select({ maxPos: sql<number>`COALESCE(MAX(${groups.position}), -1)` })
          .from(groups)
          .get();
        const nextPosition = (maxPosResult?.maxPos ?? -1) + 1;
        newGroup.position = nextPosition;

        drizzleDb.insert(groups).values(newGroup).run();
      });
      transaction();

      return c.json({ data: newGroup }, 201);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      if (
        typeof error?.message === "string" &&
        /unique|constraint/i.test(error.message)
      ) {
        return c.json(
          {
            error:
              "A group with this name already exists (including in Trash). Restore or permanently delete it first.",
          },
          400
        );
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/groups — List all groups sorted by position
  router.get("/", async (c) => {
    try {
      const { db: drizzleDb } = db();
      const allGroups = drizzleDb
        .select()
        .from(groups)
        .where(isNull(groups.deleted_at))
        .orderBy(asc(groups.position))
        .all();

      return c.json({ data: allGroups });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/groups/reorder — Reorder groups (must be before :id route)
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
        return c.json({ error: "Duplicate group ids are not allowed" }, 400);
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

      const activeGroups = drizzleDb
        .select({ id: groups.id })
        .from(groups)
        .where(isNull(groups.deleted_at))
        .all();

      if (activeGroups.length !== items.length) {
        return c.json(
          { error: "Reorder payload must include every active group exactly once" },
          400
        );
      }

      const activeIds = new Set(activeGroups.map((group) => group.id));
      for (const id of ids) {
        if (!activeIds.has(id)) {
          return c.json(
            { error: "Reorder payload must include every active group exactly once" },
            400
          );
        }
      }

      // Run in a transaction
      const transaction = sqlite.transaction(() => {
        const now = new Date().toISOString();
        for (const item of items) {
          drizzleDb
            .update(groups)
            .set({ position: item.position, updated_at: now })
            .where(eq(groups.id, item.id))
            .run();
        }
      });
      transaction();

      // Return updated groups
      const updatedGroups = drizzleDb
        .select()
        .from(groups)
        .orderBy(asc(groups.position))
        .all();

      return c.json({ data: updatedGroups });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      if (
        typeof error?.message === "string" &&
        /unique|constraint/i.test(error.message)
      ) {
        return c.json(
          {
            error:
              "A group with this name already exists (including in Trash). Restore or permanently delete it first.",
          },
          400
        );
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/groups/:id — Get a single group
  router.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb } = db();

      const group = drizzleDb
        .select()
        .from(groups)
        .where(and(eq(groups.id, id), isNull(groups.deleted_at)))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      return c.json({ data: group });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/groups/:id — Update group name
  router.patch("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { name } = body;

      // Validation
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return c.json({ error: "Name is required and must be a non-empty string" }, 400);
      }

      if (name.trim().length > 100) {
        return c.json({ error: "Name must be at most 100 characters" }, 400);
      }

      const trimmedName = autoCapitalize(name.trim());
      const normalizedName = trimmedName.toLowerCase();
      const { db: drizzleDb } = db();

      // Check group exists
      const group = drizzleDb
        .select()
        .from(groups)
        .where(and(eq(groups.id, id), isNull(groups.deleted_at)))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      // Check for duplicate name (case-insensitive, excluding self)
      const duplicate = drizzleDb
        .select()
        .from(groups)
        .where(and(sql`LOWER(${groups.name}) = ${normalizedName}`, ne(groups.id, id)))
        .get();

      if (duplicate && duplicate.id !== id) {
        return c.json(
          {
            error:
              "A group with this name already exists (including in Trash). Restore or permanently delete it first.",
          },
          400
        );
      }

      const now = new Date().toISOString();
      drizzleDb
        .update(groups)
        .set({ name: trimmedName, updated_at: now })
        .where(eq(groups.id, id))
        .run();

      const updated = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .get();

      return c.json({ data: updated });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/groups/:id — Delete group + cascade soft-delete its todos
  router.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      // Check group exists
      const group = drizzleDb
        .select()
        .from(groups)
        .where(and(eq(groups.id, id), isNull(groups.deleted_at)))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      // Run in a transaction: soft-delete the group's todos and group.
      // Keep connection_items intact so connections can come back on restore.
      const transaction = sqlite.transaction(() => {
        // Move all active todos in this group to trash
        drizzleDb
          .update(todos)
          .set({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .where(and(eq(todos.group_id, id), isNull(todos.deleted_at)))
          .run();

        // Soft-delete the group so it no longer appears in active group lists.
        drizzleDb
          .update(groups)
          .set({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .where(eq(groups.id, id))
          .run();
      });
      transaction();

      return c.json({ data: { message: "Group deleted successfully" } });
    } catch (err) {
      console.error("[DELETE /groups/:id] error:", err);
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}
