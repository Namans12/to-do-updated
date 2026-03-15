import { Hono } from "hono";
import { createGroupsRouter } from "./routes/groups.js";
import { createGroupTodosRouter, createTodosRouter } from "./routes/todos.js";
import { createTrashRouter } from "./routes/trash.js";
import { createConnectionsRouter } from "./routes/connections.js";
import { createBatchRouter } from "./routes/batch.js";
import { createSearchRouter } from "./routes/search.js";
import { createActivityRouter } from "./routes/activity.js";
import { createBackupsRouter } from "./routes/backups.js";
import { createSyncRouter } from "./routes/sync.js";
import { createTemplatesRouter } from "./routes/templates.js";

type DbOverride = Parameters<typeof createGroupsRouter>[0];

export function createApp(dbOverride?: DbOverride) {
  const app = new Hono();

  // Health check endpoint
  app.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  // Mount route modules
  app.route("/api/groups", createGroupsRouter(dbOverride));
  app.route("/api/groups/:groupId/todos", createGroupTodosRouter(dbOverride));
  app.route("/api/todos", createTodosRouter(dbOverride));
  app.route("/api/todos/batch", createBatchRouter(dbOverride));
  app.route("/api/trash", createTrashRouter(dbOverride));
  app.route("/api/connections", createConnectionsRouter(dbOverride));
  app.route("/api/search", createSearchRouter(dbOverride));
  app.route("/api/activity", createActivityRouter(dbOverride));
  app.route("/api/backups", createBackupsRouter(dbOverride));
  app.route("/api/templates", createTemplatesRouter(dbOverride));
  app.route("/api/sync", createSyncRouter(dbOverride));

  return app;
}
