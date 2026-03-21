import { Hono } from "hono";
import { eq, and, asc, sql, isNull, inArray, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { connections, connectionItems, todos } from "../db/schema.js";
import { logActivity } from "../lib/activity.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;
const CONNECTION_KINDS = ["sequence", "dependency", "branch", "related"] as const;
type ConnectionKind = (typeof CONNECTION_KINDS)[number];

function normalizeConnectionKind(value: unknown): ConnectionKind | null {
  if (value === undefined || value === null || value === "") return "sequence";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CONNECTION_KINDS.includes(normalized as ConnectionKind)
    ? (normalized as ConnectionKind)
    : null;
}

/**
 * Helper: build the response shape for a connection with its items and progress.
 */
function buildConnectionResponse(
  connection: { id: string; name: string | null; kind: string; created_at: string },
  items: Array<{
    id: string;
    todo_id: string;
    title: string;
    is_completed: number;
    high_priority: number;
    completed_at: string | null;
    created_at: string;
    position: number;
  }>
) {
  const total = items.length;
  const completed = items.filter((i) => i.is_completed === 1).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const incompleteItems = items.filter((item) => item.is_completed !== 1);
  let blockedCount = 0;
  let availableCount = incompleteItems.length;
  let nextAvailableItemId: string | null = incompleteItems[0]?.todo_id ?? null;
  let blockedTitles: string[] = [];
  let nextUnlockTitle: string | null = incompleteItems[1]?.title ?? null;
  let criticalPathLength = incompleteItems.length;

  if (connection.kind === "dependency") {
    const firstIncompleteIndex = items.findIndex((item) => item.is_completed !== 1);
    if (firstIncompleteIndex === -1) {
      availableCount = 0;
      blockedCount = 0;
      nextAvailableItemId = null;
      blockedTitles = [];
      nextUnlockTitle = null;
      criticalPathLength = 0;
    } else {
      availableCount = 1;
      const blockedItems = items
        .slice(firstIncompleteIndex + 1)
        .filter((item) => item.is_completed !== 1);
      blockedCount = blockedItems.length;
      nextAvailableItemId = items[firstIncompleteIndex]!.todo_id;
      blockedTitles = blockedItems.map((item) => item.title);
      nextUnlockTitle = blockedItems[0]?.title ?? null;
      criticalPathLength = items.slice(firstIncompleteIndex).filter((item) => item.is_completed !== 1).length;
    }
  } else if (connection.kind === "branch") {
    const root = items[0] ?? null;
    const branchItems = items.slice(1);
    const rootIncomplete = !!root && root.is_completed !== 1;
    if (rootIncomplete) {
      availableCount = 1;
      blockedCount = branchItems.filter((item) => item.is_completed !== 1).length;
      nextAvailableItemId = root.todo_id;
    } else {
      availableCount = incompleteItems.length;
      blockedCount = 0;
      nextAvailableItemId = incompleteItems[0]?.todo_id ?? null;
      blockedTitles = [];
      nextUnlockTitle = incompleteItems[0]?.title ?? null;
      criticalPathLength = incompleteItems.length;
    }
  }

  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    items: items.map((i) => ({
      id: i.id,
      todo_id: i.todo_id,
      title: i.title,
      is_completed: i.is_completed,
      high_priority: i.high_priority,
      completed_at: i.completed_at,
      created_at: i.created_at,
      position: i.position,
    })),
    progress: {
      total,
      completed,
      percentage,
      blocked_count: blockedCount,
      available_count: availableCount,
      next_available_item_id: nextAvailableItemId,
      blocked_titles: blockedTitles,
      next_unlock_title: nextUnlockTitle,
      critical_path_length: criticalPathLength,
    },
    is_fully_complete: total > 0 && completed === total,
    created_at: connection.created_at,
  };
}

/**
 * Creates the connections router.
 * Routes:
 *   POST   /api/connections                      — Create a connection with todo IDs
 *   GET    /api/connections                      — List all connections with progress
 *   GET    /api/connections/:id                  — Get connection detail + items
 *   PATCH  /api/connections/:id                  — Update connection name
 *   POST   /api/connections/merge                — Merge two connections by linking endpoints
 *   POST   /api/connections/:id/cut              — Cut a connection between adjacent items
 *   POST   /api/connections/:id/items            — Add a todo to a connection
 *   PATCH  /api/connections/:id/reorder          — Reorder connection items
 *   DELETE /api/connections/:id/items/:todoId    — Remove a todo from a connection
 *   DELETE /api/connections/:id                  — Delete a connection (not the todos)
 */
export function createConnectionsRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  /**
   * Helper: fetch items for a connection, joining with todos table.
   * Excludes soft-deleted todos from the result.
   */
  function getConnectionItems(drizzleDb: ReturnType<typeof db>["db"], connectionId: string) {
    const items = drizzleDb
      .select({
        id: connectionItems.id,
        todo_id: connectionItems.todo_id,
        title: todos.title,
        is_completed: todos.is_completed,
        high_priority: todos.high_priority,
        completed_at: todos.completed_at,
        created_at: todos.created_at,
        position: connectionItems.position,
      })
      .from(connectionItems)
      .innerJoin(todos, eq(connectionItems.todo_id, todos.id))
      .where(
        and(
          eq(connectionItems.connection_id, connectionId),
          isNull(todos.deleted_at)
        )
      )
      .orderBy(asc(connectionItems.position))
      .all();

    return items;
  }

  // POST /api/connections — Create a connection with todo IDs
  router.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { name, todoIds, kind } = body;

      // Validate todoIds
      if (!Array.isArray(todoIds) || todoIds.length < 2) {
        return c.json(
          { error: "todoIds must be an array with at least 2 items" },
          400
        );
      }
      if (todoIds.length > 7) {
        return c.json(
          { error: "Connections can have at most 7 items" },
          400
        );
      }

      // Validate all todoIds are strings
      for (const id of todoIds) {
        if (typeof id !== "string" || id.trim().length === 0) {
          return c.json(
            { error: "Each todoId must be a non-empty string" },
            400
          );
        }
      }

      // Check for duplicates in the input
      const uniqueIds = new Set(todoIds);
      if (uniqueIds.size !== todoIds.length) {
        return c.json({ error: "Duplicate todoIds are not allowed" }, 400);
      }

      const { db: drizzleDb, sqlite } = db();

      // Validate all todos exist and are not soft-deleted
      for (const todoId of todoIds) {
        const todo = drizzleDb
          .select()
          .from(todos)
          .where(and(eq(todos.id, todoId), isNull(todos.deleted_at)))
          .get();

        if (!todo) {
          return c.json(
            { error: `Todo with id '${todoId}' not found or is deleted` },
            404
          );
        }
      }

      // A todo can only belong to one connection at a time.
      for (const todoId of todoIds) {
        const existingMembership = drizzleDb
          .select()
          .from(connectionItems)
          .where(eq(connectionItems.todo_id, todoId))
          .get();

        if (existingMembership) {
          return c.json(
            {
              error: `Todo '${todoId}' already belongs to a connection. A todo can belong to at most 1 connection.`,
            },
            400
          );
        }
      }

      // Validate name if provided
      if (name !== undefined && name !== null) {
        if (typeof name !== "string") {
          return c.json({ error: "Name must be a string" }, 400);
        }
      }
      const normalizedKind = normalizeConnectionKind(kind);
      if (!normalizedKind) {
        return c.json(
          { error: `kind must be one of: ${CONNECTION_KINDS.join(", ")}` },
          400
        );
      }
      if (normalizedKind === "branch" && todoIds.length > 3) {
        return c.json(
          { error: "Branch connections can include at most 3 items (1 root + 2 branches)" },
          400
        );
      }
      if (todoIds.length > 7) {
        return c.json(
          { error: "Connections can have at most 7 items" },
          400
        );
      }

      const now = new Date().toISOString();
      const connectionId = uuidv4();
      const trimmedName =
        name !== undefined && name !== null && typeof name === "string"
          ? name.trim() || null
          : null;

      if (trimmedName) {
        const normalizedName = trimmedName.toLowerCase();
        const duplicate = drizzleDb
          .select()
          .from(connections)
          .where(sql`LOWER(${connections.name}) = ${normalizedName}`)
          .get();
        if (duplicate) {
          return c.json({ error: "A connection with this name already exists" }, 400);
        }
      }

      // Create connection and items in a transaction
      const transaction = sqlite.transaction(() => {
        drizzleDb
          .insert(connections)
          .values({
            id: connectionId,
            name: trimmedName,
            kind: normalizedKind,
            created_at: now,
          })
          .run();

        for (let i = 0; i < todoIds.length; i++) {
          drizzleDb
            .insert(connectionItems)
            .values({
              id: uuidv4(),
              connection_id: connectionId,
              todo_id: todoIds[i],
              position: i,
            })
            .run();
        }
      });
      transaction();

      // Fetch the created connection with items
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get()!;

      const items = getConnectionItems(drizzleDb, connectionId);
      const response = buildConnectionResponse(connection, items);
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: connectionId,
        action: "created",
        summary: `Created ${normalizedKind} connection${trimmedName ? ` "${trimmedName}"` : ""}`,
        payload: {
          todo_ids: todoIds,
          kind: normalizedKind,
        },
      });

      return c.json({ data: response }, 201);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      if (
        typeof error?.message === "string" &&
        /unique|constraint/i.test(error.message)
      ) {
        return c.json({ error: "A connection with this name already exists" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/connections — List all connections with progress
  router.get("/", async (c) => {
    try {
      const { db: drizzleDb } = db();

      const allConnections = drizzleDb
        .select()
        .from(connections)
        .orderBy(asc(connections.created_at))
        .all();

      const result = allConnections.map((conn) => {
        const items = getConnectionItems(drizzleDb, conn.id);
        return buildConnectionResponse(conn, items);
      });

      return c.json({ data: result });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // GET /api/connections/:id — Get connection detail + items
  router.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb } = db();

      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      const items = getConnectionItems(drizzleDb, id);
      const response = buildConnectionResponse(connection, items);

      return c.json({ data: response });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/connections/:id — Update connection name
  router.patch("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json();
      const { name, kind } = body;

      const { db: drizzleDb } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Validate name
      if (name === undefined) {
        if (kind === undefined) {
          return c.json({ error: "At least one of name or kind must be provided" }, 400);
        }
      }

      let updatedName = connection.name;
      if (name === undefined) {
        updatedName = connection.name;
      } else if (name === null) {
        updatedName = null;
      } else if (typeof name === "string") {
        updatedName = name.trim() || null;
      } else {
        return c.json({ error: "Name must be a string or null" }, 400);
      }

      if (updatedName) {
        const normalizedName = updatedName.toLowerCase();
        const duplicate = drizzleDb
          .select()
          .from(connections)
          .where(and(sql`LOWER(${connections.name}) = ${normalizedName}`, ne(connections.id, id)))
          .get();
        if (duplicate) {
          return c.json({ error: "A connection with this name already exists" }, 400);
        }
      }
      const normalizedKind = kind === undefined ? connection.kind : normalizeConnectionKind(kind);
      if (!normalizedKind) {
        return c.json(
          { error: `kind must be one of: ${CONNECTION_KINDS.join(", ")}` },
          400
        );
      }
      const existingItems = getConnectionItems(drizzleDb, id);
      if (normalizedKind === "branch" && existingItems.length > 3) {
        return c.json(
          { error: "Branch connections can include at most 3 items (1 root + 2 branches)" },
          400
        );
      }

      drizzleDb
        .update(connections)
        .set({ name: updatedName, kind: normalizedKind })
        .where(eq(connections.id, id))
        .run();

      // Return updated connection with items
      const updated = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get()!;

      const items = getConnectionItems(drizzleDb, id);
      const response = buildConnectionResponse(updated, items);
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: id,
        action: "updated",
        summary: `Updated connection${updated.name ? ` "${updated.name}"` : ""}`,
        payload: {
          kind: normalizedKind,
          name: updatedName,
        },
      });

      return c.json({ data: response });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      if (
        typeof error?.message === "string" &&
        /unique|constraint/i.test(error.message)
      ) {
        return c.json({ error: "A connection with this name already exists" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/connections/merge — Merge two existing connections by linking endpoints
  router.post("/merge", async (c) => {
    try {
      const body = await c.req.json();
      const { fromTodoId, toTodoId } = body ?? {};

      if (
        typeof fromTodoId !== "string" ||
        fromTodoId.trim().length === 0 ||
        typeof toTodoId !== "string" ||
        toTodoId.trim().length === 0
      ) {
        return c.json(
          { error: "fromTodoId and toTodoId are required and must be non-empty strings" },
          400
        );
      }
      if (fromTodoId === toTodoId) {
        return c.json({ error: "Cannot merge using the same todo id" }, 400);
      }

      const { db: drizzleDb, sqlite } = db();

      const fromMemberships = drizzleDb
        .select({ connection_id: connectionItems.connection_id })
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, fromTodoId))
        .all()
        .map((r) => r.connection_id);

      const toMemberships = drizzleDb
        .select({ connection_id: connectionItems.connection_id })
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, toTodoId))
        .all()
        .map((r) => r.connection_id);

      if (fromMemberships.length === 0 || toMemberships.length === 0) {
        return c.json(
          { error: "Both todos must already belong to an existing connection to merge" },
          400
        );
      }

      const shared = fromMemberships.find((id) => toMemberships.includes(id));
      if (shared) {
        return c.json({ error: "Both todos are already in the same connection" }, 400);
      }

      const fromConnectionId = fromMemberships[0]!;
      const toConnectionId = toMemberships[0]!;

      if (fromMemberships.length > 1 || toMemberships.length > 1) {
        return c.json(
          {
            error:
              "Merge is ambiguous because one of the selected todos belongs to multiple connections. Use endpoint todos to merge cleanly.",
          },
          400
        );
      }

      const fromConnection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, fromConnectionId))
        .get();
      const toConnection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, toConnectionId))
        .get();

      if (!fromConnection || !toConnection) {
        return c.json({ error: "One of the connections was not found" }, 404);
      }

      const fromItems = getConnectionItems(drizzleDb, fromConnectionId);
      const toItems = getConnectionItems(drizzleDb, toConnectionId);
      const fromIds = fromItems.map((i) => i.todo_id);
      const toIds = toItems.map((i) => i.todo_id);

      if (fromIds.length < 1 || toIds.length < 1) {
        return c.json({ error: "Cannot merge empty connections" }, 400);
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
        return c.json(
          {
            error:
              "Merge requires linking chain endpoints. Select an endpoint todo from each connection.",
          },
          400
        );
      }

      const overlap = fromChain.some((id) => toChain.includes(id));
      if (overlap) {
        return c.json({ error: "Cannot merge connections that share todos" }, 400);
      }

      const mergedTodoIds = [...fromChain, ...toChain];
      if (mergedTodoIds.length > 7) {
        return c.json(
          { error: "Merged connection exceeds max depth of 7 items" },
          400
        );
      }
      const mergedKind = fromConnection.kind;
      if (mergedKind === "branch" && mergedTodoIds.length > 3) {
        return c.json(
          { error: "Branch connections can include at most 3 items (1 root + 2 branches)" },
          400
        );
      }
      const dedup = new Set(mergedTodoIds);
      if (dedup.size !== mergedTodoIds.length) {
        return c.json({ error: "Merged chain produced duplicate todos" }, 400);
      }

      const transaction = sqlite.transaction(() => {
        drizzleDb
          .delete(connectionItems)
          .where(
            inArray(connectionItems.connection_id, [
              fromConnectionId,
              toConnectionId,
            ])
          )
          .run();

        for (let i = 0; i < mergedTodoIds.length; i++) {
          drizzleDb
            .insert(connectionItems)
            .values({
              id: uuidv4(),
              connection_id: fromConnectionId,
              todo_id: mergedTodoIds[i]!,
              position: i,
            })
            .run();
        }

        drizzleDb
          .delete(connections)
          .where(eq(connections.id, toConnectionId))
          .run();
      });
      transaction();

      const updated = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, fromConnectionId))
        .get()!;
      const updatedItems = getConnectionItems(drizzleDb, fromConnectionId);
      const response = buildConnectionResponse(updated, updatedItems);
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: fromConnectionId,
        action: "merged",
        summary: `Merged two connections into ${updated.name ?? "a shared chain"}`,
        payload: {
          todo_ids: mergedTodoIds,
          merged_connection_id: toConnectionId,
        },
      });

      return c.json({ data: response });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/connections/:id/cut — Cut a connection between adjacent items
  router.post("/:id/cut", async (c) => {
    try {
      const connectionId = c.req.param("id");
      const body = await c.req.json();
      const { fromTodoId, toTodoId } = body ?? {};

      if (
        typeof fromTodoId !== "string" ||
        fromTodoId.trim().length === 0 ||
        typeof toTodoId !== "string" ||
        toTodoId.trim().length === 0
      ) {
        return c.json(
          { error: "fromTodoId and toTodoId are required and must be non-empty strings" },
          400
        );
      }
      if (fromTodoId === toTodoId) {
        return c.json({ error: "Cannot cut using the same todo id" }, 400);
      }

      const { db: drizzleDb, sqlite } = db();

      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      const items = getConnectionItems(drizzleDb, connectionId);
      const ids = items.map((i) => i.todo_id);
      if (ids.length < 2) {
        return c.json({ error: "Connection must have at least 2 items to cut" }, 400);
      }

      let cutIndex = -1;
      for (let i = 0; i < ids.length - 1; i++) {
        if (
          (ids[i] === fromTodoId && ids[i + 1] === toTodoId) ||
          (ids[i] === toTodoId && ids[i + 1] === fromTodoId)
        ) {
          cutIndex = i;
          break;
        }
      }
      if (cutIndex === -1) {
        return c.json({ error: "Cut requires adjacent items in this connection" }, 400);
      }

      const left = ids.slice(0, cutIndex + 1);
      const right = ids.slice(cutIndex + 1);

      const now = new Date().toISOString();
      const newConnectionId = uuidv4();

      const transaction = sqlite.transaction(() => {
        drizzleDb
          .delete(connectionItems)
          .where(eq(connectionItems.connection_id, connectionId))
          .run();

        if (left.length >= 2) {
          for (let i = 0; i < left.length; i++) {
            drizzleDb
              .insert(connectionItems)
              .values({
                id: uuidv4(),
                connection_id: connectionId,
                todo_id: left[i]!,
                position: i,
              })
              .run();
          }
        }

        if (right.length >= 2) {
          drizzleDb
            .insert(connections)
            .values({
              id: newConnectionId,
              name: null,
              kind: connection.kind,
              created_at: now,
            })
            .run();

          for (let i = 0; i < right.length; i++) {
            drizzleDb
              .insert(connectionItems)
              .values({
                id: uuidv4(),
                connection_id: newConnectionId,
                todo_id: right[i]!,
                position: i,
              })
              .run();
          }
        }

        if (left.length < 2) {
          drizzleDb
            .delete(connections)
            .where(eq(connections.id, connectionId))
            .run();
        }
      });
      transaction();

      const leftConn =
        left.length >= 2
          ? drizzleDb
              .select()
              .from(connections)
              .where(eq(connections.id, connectionId))
              .get()
          : null;
      const rightConn =
        right.length >= 2
          ? drizzleDb
              .select()
              .from(connections)
              .where(eq(connections.id, newConnectionId))
              .get()
          : null;
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: connectionId,
        action: "cut",
        summary: `Cut a connection into ${leftConn ? "left" : "single"} and ${rightConn ? "right" : "single"} parts`,
        payload: {
          from_todo_id: fromTodoId,
          to_todo_id: toTodoId,
          left_count: left.length,
          right_count: right.length,
        },
      });

      return c.json({
        data: {
          left: leftConn ? buildConnectionResponse(leftConn, getConnectionItems(drizzleDb, leftConn.id)) : null,
          right: rightConn ? buildConnectionResponse(rightConn, getConnectionItems(drizzleDb, rightConn.id)) : null,
        },
      });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // POST /api/connections/:id/items — Add a todo to a connection
  router.post("/:id/items", async (c) => {
    try {
      const connectionId = c.req.param("id");
      const body = await c.req.json();
      const { todoId } = body;

      if (!todoId || typeof todoId !== "string" || todoId.trim().length === 0) {
        return c.json(
          { error: "todoId is required and must be a non-empty string" },
          400
        );
      }

      const { db: drizzleDb } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Check todo exists and is not soft-deleted
      const todo = drizzleDb
        .select()
        .from(todos)
        .where(and(eq(todos.id, todoId), isNull(todos.deleted_at)))
        .get();

      if (!todo) {
        return c.json({ error: "Todo not found or is deleted" }, 404);
      }

      // A todo can only belong to one connection at a time.
      const existingMembership = drizzleDb
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, todoId))
        .get();

      // Also check it's not already in THIS specific connection
      const alreadyInThis = drizzleDb
        .select()
        .from(connectionItems)
        .where(
          and(
            eq(connectionItems.connection_id, connectionId),
            eq(connectionItems.todo_id, todoId)
          )
        )
        .get();

      if (alreadyInThis) {
        return c.json(
          {
            error: "Todo already belongs to this connection.",
          },
          400
        );
      }

      if (existingMembership) {
        return c.json(
          {
            error:
              "Todo already belongs to a connection. A todo can belong to at most 1 connection.",
          },
          400
        );
      }

      // Get the max position within this connection
      const maxPosResult = drizzleDb
        .select({
          maxPos: sql<number>`COALESCE(MAX(${connectionItems.position}), -1)`,
        })
        .from(connectionItems)
        .where(eq(connectionItems.connection_id, connectionId))
        .get();
      const nextPosition = (maxPosResult?.maxPos ?? -1) + 1;
      if (nextPosition >= 7) {
        return c.json(
          { error: "Connections can have at most 7 items" },
          400
        );
      }
      if (connection.kind === "branch" && nextPosition >= 3) {
        return c.json(
          { error: "Branch connections can include at most 3 items (1 root + 2 branches)" },
          400
        );
      }

      // Insert the new connection item
      drizzleDb
        .insert(connectionItems)
        .values({
          id: uuidv4(),
          connection_id: connectionId,
          todo_id: todoId,
          position: nextPosition,
        })
        .run();

      // Return the updated connection
      const items = getConnectionItems(drizzleDb, connectionId);
      const response = buildConnectionResponse(connection, items);
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: connectionId,
        action: "item_added",
        summary: `Added "${todo.title}" to a connection`,
        payload: {
          todo_id: todoId,
          connection_id: connectionId,
        },
      });

      return c.json({ data: response });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // PATCH /api/connections/:id/reorder — Reorder connection items
  router.patch("/:id/reorder", async (c) => {
    try {
      const connectionId = c.req.param("id");
      const body = await c.req.json();
      const { todoIds } = body ?? {};

      if (!Array.isArray(todoIds) || todoIds.length < 2) {
        return c.json(
          { error: "todoIds must be an array with at least 2 items" },
          400
        );
      }
      if (todoIds.length > 7) {
        return c.json(
          { error: "Connections can have at most 7 items" },
          400
        );
      }
      for (const id of todoIds) {
        if (typeof id !== "string" || id.trim().length === 0) {
          return c.json(
            { error: "Each todoId must be a non-empty string" },
            400
          );
        }
      }
      const unique = new Set(todoIds);
      if (unique.size !== todoIds.length) {
        return c.json({ error: "Duplicate todoIds are not allowed" }, 400);
      }

      const { db: drizzleDb, sqlite } = db();

      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get();
      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      const existingItems = drizzleDb
        .select({ todo_id: connectionItems.todo_id })
        .from(connectionItems)
        .where(eq(connectionItems.connection_id, connectionId))
        .all()
        .map((r) => r.todo_id);

      if (existingItems.length !== todoIds.length) {
        return c.json(
          { error: "todoIds must match all items in this connection" },
          400
        );
      }

      const existingSet = new Set(existingItems);
      for (const id of todoIds) {
        if (!existingSet.has(id)) {
          return c.json(
            { error: "todoIds must match all items in this connection" },
            400
          );
        }
      }

      const transaction = sqlite.transaction(() => {
        for (let i = 0; i < todoIds.length; i++) {
          drizzleDb
            .update(connectionItems)
            .set({ position: i })
            .where(
              and(
                eq(connectionItems.connection_id, connectionId),
                eq(connectionItems.todo_id, todoIds[i]!)
              )
            )
            .run();
        }
      });
      transaction();

      const items = getConnectionItems(drizzleDb, connectionId);
      const response = buildConnectionResponse(connection, items);
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: connectionId,
        action: "reordered",
        summary: `Reordered tasks inside a connection`,
        payload: {
          todo_ids: todoIds,
        },
      });

      return c.json({ data: response });
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/connections/:id/items/:todoId — Remove a todo from a connection
  router.delete("/:id/items/:todoId", async (c) => {
    try {
      const connectionId = c.req.param("id");
      const todoId = c.req.param("todoId");

      const { db: drizzleDb, sqlite } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Check the todo is in this connection
      const item = drizzleDb
        .select()
        .from(connectionItems)
        .where(
          and(
            eq(connectionItems.connection_id, connectionId),
            eq(connectionItems.todo_id, todoId)
          )
        )
        .get();

      if (!item) {
        return c.json(
          { error: "Todo is not part of this connection" },
          404
        );
      }

      // Count current items in the connection
      const countResult = drizzleDb
        .select({ count: sql<number>`COUNT(*)` })
        .from(connectionItems)
        .where(eq(connectionItems.connection_id, connectionId))
        .get();
      const currentCount = countResult?.count ?? 0;

      if (currentCount <= 2) {
        // If this removal would leave <=1 item, remove all and delete connection
        const transaction = sqlite.transaction(() => {
          drizzleDb
            .delete(connectionItems)
            .where(eq(connectionItems.connection_id, connectionId))
            .run();

          drizzleDb
            .delete(connections)
            .where(eq(connections.id, connectionId))
            .run();
        });
        transaction();

        logActivity(drizzleDb, {
          entity_type: "connection",
          entity_id: connectionId,
          action: "deleted",
          summary: `Deleted a connection after removing "${todoId}"`,
          payload: { todo_id: todoId },
        });

        return c.json({
          data: { message: "Connection deleted (minimum size not met)" },
        });
      }

      // Remove the item
      drizzleDb
        .delete(connectionItems)
        .where(
          and(
            eq(connectionItems.connection_id, connectionId),
            eq(connectionItems.todo_id, todoId)
          )
        )
        .run();

      // Return updated connection
      const updatedConnection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, connectionId))
        .get()!;

      const items = getConnectionItems(drizzleDb, connectionId);
      const response = buildConnectionResponse(updatedConnection, items);
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: connectionId,
        action: "item_removed",
        summary: `Removed a task from a connection`,
        payload: { todo_id: todoId },
      });

      return c.json({ data: response });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  // DELETE /api/connections/:id — Delete a connection (not the todos)
  router.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const { db: drizzleDb, sqlite } = db();

      // Check connection exists
      const connection = drizzleDb
        .select()
        .from(connections)
        .where(eq(connections.id, id))
        .get();

      if (!connection) {
        return c.json({ error: "Connection not found" }, 404);
      }

      // Delete connection and its items in a transaction
      const transaction = sqlite.transaction(() => {
        drizzleDb
          .delete(connectionItems)
          .where(eq(connectionItems.connection_id, id))
          .run();

        drizzleDb
          .delete(connections)
          .where(eq(connections.id, id))
          .run();
      });
      transaction();
      logActivity(drizzleDb, {
        entity_type: "connection",
        entity_id: id,
        action: "deleted",
        summary: `Deleted connection${connection.name ? ` "${connection.name}"` : ""}`,
      });

      return c.json({
        data: { message: "Connection deleted successfully" },
      });
    } catch {
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return router;
}
