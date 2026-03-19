import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { getDb } from "../db/connection.js";
import { connectionItems, connections, groups, todos } from "../db/schema.js";
import { logActivity } from "../lib/activity.js";

type DbOverride = ReturnType<typeof getDb>;

interface TemplateFilePayload {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  source_group_id: string | null;
  counts: {
    todos: number;
    connections: number;
  };
  snapshot: {
    todos: Array<{
      original_id: string;
      title: string;
      description: string | null;
      high_priority: number;
      recurrence_rule: string | null;
      recurrence_enabled: number;
      next_occurrence_at: string | null;
    }>;
    connections: Array<{
      name: string | null;
      kind: string;
      todo_original_ids: string[];
    }>;
  };
}

function templatesDir() {
  return path.join(process.cwd(), "data", "templates");
}

function ensureTemplatesDir() {
  const dir = templatesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function templatePath(id: string) {
  return path.join(ensureTemplatesDir(), `${id}.json`);
}

function readTemplateFiles() {
  const dir = ensureTemplatesDir();
  const parsed: TemplateFilePayload[] = [];
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
    const fullPath = path.join(dir, name);
    try {
      const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as Partial<TemplateFilePayload>;
      if (
        typeof payload?.id !== "string" ||
        typeof payload?.name !== "string" ||
        typeof payload?.created_at !== "string"
      ) {
        console.warn(`[templates] Skipping malformed template file: ${name}`);
        continue;
      }
      parsed.push(payload as TemplateFilePayload);
    } catch (error) {
      console.warn(
        `[templates] Failed to parse template file: ${name}`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return parsed.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function createTemplatesRouter(dbOverride?: DbOverride) {
  const router = new Hono();

  function db() {
    return dbOverride ?? getDb();
  }

  router.get("/", () => {
    const data = readTemplateFiles().map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      created_at: template.created_at,
      source_group_id: template.source_group_id,
      counts: template.counts,
    }));
    return new Response(JSON.stringify({ data }), {
      headers: { "Content-Type": "application/json" },
    });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sourceGroupId =
      typeof body?.source_group_id === "string" && body.source_group_id.trim()
        ? body.source_group_id
        : null;
    const name =
      typeof body?.name === "string" && body.name.trim()
        ? body.name.trim()
        : null;
    const description =
      typeof body?.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;

    if (!sourceGroupId) {
      return c.json({ error: "source_group_id is required" }, 400);
    }

    const { db: drizzleDb } = db();
    const sourceGroup = drizzleDb
      .select()
      .from(groups)
      .where(and(eq(groups.id, sourceGroupId), isNull(groups.deleted_at)))
      .get();

    if (!sourceGroup) {
      return c.json({ error: "Source group not found" }, 404);
    }

    const activeTodos = drizzleDb
      .select()
      .from(todos)
      .where(and(eq(todos.group_id, sourceGroupId), isNull(todos.deleted_at)))
      .orderBy(asc(todos.position))
      .all();

    if (activeTodos.length === 0) {
      return c.json({ error: "Cannot create a template from an empty group" }, 400);
    }

    const todoIds = activeTodos.map((todo) => todo.id);
    const templateConnections = todoIds.length
      ? drizzleDb
          .select()
          .from(connections)
          .where(
            inArray(
              connections.id,
              drizzleDb
                .select({ connection_id: connectionItems.connection_id })
                .from(connectionItems)
                .where(inArray(connectionItems.todo_id, todoIds))
            )
          )
          .all()
      : [];

    const itemsByConnectionId = new Map<string, string[]>();
    for (const connection of templateConnections) {
      const ids = drizzleDb
        .select({ todo_id: connectionItems.todo_id })
        .from(connectionItems)
        .where(eq(connectionItems.connection_id, connection.id))
        .orderBy(asc(connectionItems.position))
        .all()
        .map((row) => row.todo_id)
        .filter((todoId) => todoIds.includes(todoId));
      if (ids.length >= 2) {
        itemsByConnectionId.set(connection.id, ids);
      }
    }

    const createdAt = new Date().toISOString();
    const templateId = crypto.randomUUID();
    const payload: TemplateFilePayload = {
      id: templateId,
      name: name ?? `${sourceGroup.name} Template`,
      description,
      created_at: createdAt,
      source_group_id: sourceGroupId,
      counts: {
        todos: activeTodos.length,
        connections: itemsByConnectionId.size,
      },
      snapshot: {
        todos: activeTodos.map((todo) => ({
          original_id: todo.id,
          title: todo.title,
          description: todo.description,
          high_priority: todo.high_priority,
          recurrence_rule: todo.recurrence_rule,
          recurrence_enabled: todo.recurrence_enabled,
          next_occurrence_at: todo.next_occurrence_at,
        })),
        connections: templateConnections
          .filter((connection) => itemsByConnectionId.has(connection.id))
          .map((connection) => ({
            name: connection.name,
            kind: connection.kind,
            todo_original_ids: itemsByConnectionId.get(connection.id)!,
          })),
      },
    };

    fs.writeFileSync(templatePath(templateId), JSON.stringify(payload, null, 2), "utf8");
    logActivity(drizzleDb, {
      entity_type: "template",
      entity_id: templateId,
      action: "created",
      summary: `Created template "${payload.name}"`,
      payload: payload.counts,
    });

    return c.json({
      data: {
        id: payload.id,
        name: payload.name,
        description: payload.description,
        created_at: payload.created_at,
        source_group_id: payload.source_group_id,
        counts: payload.counts,
      },
    }, 201);
  });

  router.post("/:id/apply", async (c) => {
    const templateId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const targetGroupId =
      typeof body?.group_id === "string" && body.group_id.trim() ? body.group_id : null;

    if (!targetGroupId) {
      return c.json({ error: "group_id is required" }, 400);
    }

    const fullPath = templatePath(templateId);
    if (!fs.existsSync(fullPath)) {
      return c.json({ error: "Template not found" }, 404);
    }

    const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as TemplateFilePayload;
    const { db: drizzleDb, sqlite } = db();

    const group = drizzleDb
      .select()
      .from(groups)
      .where(and(eq(groups.id, targetGroupId), isNull(groups.deleted_at)))
      .get();
    if (!group) {
      return c.json({ error: "Target group not found" }, 404);
    }

    const now = new Date().toISOString();
    const idMap = new Map<string, string>();

    const transaction = sqlite.transaction(() => {
      const maxPosResult = drizzleDb
        .select({ maxPos: sql<number>`COALESCE(MAX(${todos.position}), -1)` })
        .from(todos)
        .where(and(eq(todos.group_id, targetGroupId), isNull(todos.deleted_at)))
        .get();
      let nextPosition = (maxPosResult?.maxPos ?? -1) + 1;

      for (const todo of payload.snapshot.todos) {
        const nextId = uuidv4();
        idMap.set(todo.original_id, nextId);
        drizzleDb
          .insert(todos)
          .values({
            id: nextId,
            group_id: targetGroupId,
            title: todo.title,
            description: todo.description,
            high_priority: todo.high_priority,
            reminder_at: null,
            recurrence_rule: todo.recurrence_rule,
            recurrence_enabled: todo.recurrence_enabled,
            next_occurrence_at: todo.next_occurrence_at,
            is_completed: 0,
            completed_at: null,
            position: nextPosition,
            deleted_at: null,
            created_at: now,
            updated_at: now,
          })
          .run();
        nextPosition += 1;
      }

      for (const connection of payload.snapshot.connections) {
        const todoIds = connection.todo_original_ids
          .map((id) => idMap.get(id))
          .filter((id): id is string => !!id);
        if (todoIds.length < 2) continue;
        const connectionId = uuidv4();
        drizzleDb
          .insert(connections)
          .values({
            id: connectionId,
            name: connection.name,
            kind: connection.kind,
            created_at: now,
          })
          .run();
        todoIds.forEach((todoId, index) => {
          drizzleDb
            .insert(connectionItems)
            .values({
              id: uuidv4(),
              connection_id: connectionId,
              todo_id: todoId,
              position: index,
            })
            .run();
        });
      }
    });
    transaction();

    logActivity(drizzleDb, {
      entity_type: "template",
      entity_id: templateId,
      action: "applied",
      summary: `Applied template "${payload.name}" to "${group.name}"`,
      payload: {
        group_id: targetGroupId,
        todos: payload.snapshot.todos.length,
        connections: payload.snapshot.connections.length,
      },
    });

    return c.json({
      data: {
        group_id: targetGroupId,
        template_id: templateId,
        created_todo_count: payload.snapshot.todos.length,
        created_connection_count: payload.snapshot.connections.length,
      },
    });
  });

  router.delete("/:id", (c) => {
    const templateId = c.req.param("id");
    const fullPath = templatePath(templateId);
    if (!fs.existsSync(fullPath)) {
      return c.json({ error: "Template not found" }, 404);
    }
    const payload = JSON.parse(fs.readFileSync(fullPath, "utf8")) as TemplateFilePayload;
    fs.unlinkSync(fullPath);
    const { db: drizzleDb } = db();
    logActivity(drizzleDb, {
      entity_type: "template",
      entity_id: templateId,
      action: "deleted",
      summary: `Deleted template "${payload.name}"`,
    });
    return c.json({ data: { message: "Template deleted successfully" } });
  });

  return router;
}
