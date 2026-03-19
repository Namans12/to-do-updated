import { Hono } from "hono";
import { eq, and, isNull, or, like, sql } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { connectionItems, connections, groups, todos } from "../db/schema.js";

// Type for the injected DB (allows test override)
type DbOverride = ReturnType<typeof getDb>;

/**
 * Creates the search router for searching todos.
 * Endpoints:
 * - GET /api/search - Search todos by query string with optional filters
 *
 * Query Parameters:
 * - q (required): search term
 * - completed (optional): true/false/all - filter by completion status
 * - group_id (optional): filter by group
 *
 * Results are sorted by relevance (title match > description match)
 */
export function createSearchRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  // GET /api/search — Search todos by query string
  router.get("/", (c) => {
    const query = c.req.query("q");
    const completedParam = c.req.query("completed");
    const groupIdParam = c.req.query("group_id");
    const highPriorityParam = c.req.query("high_priority");
    const hasReminderParam = c.req.query("has_reminder");
    const connectionKindParam = c.req.query("connection_kind");
    const sortParam = c.req.query("sort");

    // Validate required query parameter
    if (!query || query.trim() === "") {
      return c.json({ error: "Query parameter 'q' is required and cannot be empty" }, 400);
    }

    const searchTerm = query.trim();
    const { db: drizzleDb } = db();

    // Build the search pattern for LIKE queries (case-insensitive in SQLite by default for ASCII)
    const searchPattern = `%${searchTerm}%`;

    // Start with base conditions: not deleted, and matches search term in title or description
    // Using SQL LIKE with COLLATE NOCASE for case-insensitive search
    const searchConditions = and(
      isNull(todos.deleted_at),
      or(
        like(todos.title, searchPattern),
        like(todos.description, searchPattern)
      )
    );

    // Build dynamic where conditions
    let whereConditions = searchConditions;

    // Filter by completion status
    if (completedParam !== undefined && completedParam !== "all") {
      if (completedParam === "true") {
        whereConditions = and(whereConditions, eq(todos.is_completed, 1));
      } else if (completedParam === "false") {
        whereConditions = and(whereConditions, eq(todos.is_completed, 0));
      }
      // If completedParam is something else, we ignore it (treat as "all")
    }

    // Filter by group_id
    if (groupIdParam) {
      // First verify the group exists
      const group = drizzleDb
        .select()
        .from(groups)
        .where(eq(groups.id, groupIdParam))
        .get();

      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }

      whereConditions = and(whereConditions, eq(todos.group_id, groupIdParam));
    }

    if (highPriorityParam === "true") {
      whereConditions = and(whereConditions, eq(todos.high_priority, 1));
    } else if (highPriorityParam === "false") {
      whereConditions = and(whereConditions, eq(todos.high_priority, 0));
    }

    if (hasReminderParam === "true") {
      whereConditions = and(whereConditions, sql`${todos.reminder_at} IS NOT NULL`);
    } else if (hasReminderParam === "false") {
      whereConditions = and(whereConditions, sql`${todos.reminder_at} IS NULL`);
    }

    if (connectionKindParam) {
      whereConditions = and(whereConditions, eq(connections.kind, connectionKindParam));
    }

    // Execute the search query with join to get group name
    const results = drizzleDb
      .select({
        id: todos.id,
        title: todos.title,
        description: todos.description,
        high_priority: todos.high_priority,
        is_completed: todos.is_completed,
        position: todos.position,
        group_id: todos.group_id,
        group_name: groups.name,
        reminder_at: todos.reminder_at,
        recurrence_rule: todos.recurrence_rule,
        connection_kind: connections.kind,
        created_at: todos.created_at,
        updated_at: todos.updated_at,
      })
      .from(todos)
      .innerJoin(groups, eq(todos.group_id, groups.id))
      .leftJoin(connectionItems, eq(connectionItems.todo_id, todos.id))
      .leftJoin(connections, eq(connectionItems.connection_id, connections.id))
      .where(whereConditions)
      .all();

    // Sort by relevance: title matches first, then description matches
    // Within each category, sort by updated_at descending (most recent first)
    const searchTermLower = searchTerm.toLowerCase();

    const sortedResults = results.sort((a, b) => {
      if (sortParam === "created_oldest") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortParam === "created_newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortParam === "updated_oldest") {
        return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      }

      const aTitleMatch = a.title.toLowerCase().includes(searchTermLower);
      const bTitleMatch = b.title.toLowerCase().includes(searchTermLower);

      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;

      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return c.json({
      data: {
        query: searchTerm,
        count: sortedResults.length,
        results: sortedResults.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          high_priority: r.high_priority,
          is_completed: r.is_completed,
          position: r.position,
          reminder_at: r.reminder_at,
          recurrence_rule: r.recurrence_rule,
          connection_kind: r.connection_kind,
          group: {
            id: r.group_id,
            name: r.group_name,
          },
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      },
    });
  });

  return router;
}
