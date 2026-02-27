import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { getDb, closeDb } from "./db/connection.js";
import { startAutoPurgeScheduler } from "./routes/trash.js";

const PORT = 8080;

// Run migrations on startup to ensure tables exist
runMigrations();

// Initialize the database connection (sets pragmas, verifies connection)
const { sqlite } = getDb();
console.log(`Database connected at ./data/todos.db`);
console.log(`WAL mode: ${sqlite.pragma("journal_mode", { simple: true })}`);

const app = createApp();

console.log(`Nodes To-Do server starting on port ${PORT}...`);

const server = serve({
  fetch: app.fetch,
  port: PORT,
});

console.log(`Server running at http://localhost:${PORT}`);

// Start auto-purge scheduler (runs on startup + every 6 hours)
const purgeIntervalId = startAutoPurgeScheduler();
console.log("Auto-purge scheduler started (runs every 6 hours)");

// Graceful shutdown
function gracefulShutdown() {
  console.log("\nShutting down gracefully...");
  clearInterval(purgeIntervalId);
  closeDb();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
