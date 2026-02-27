import { createSqliteConnection } from "./connection.js";

/**
 * Creates all tables in the SQLite database.
 * This is a simple migration that creates the schema from scratch.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export function runMigrations(dbPath?: string): void {
  const sqlite = createSqliteConnection(dbPath);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id),
      title TEXT NOT NULL,
      description TEXT,
      high_priority INTEGER NOT NULL DEFAULT 0,
      reminder_at TEXT,
      is_completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_items (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id),
      todo_id TEXT NOT NULL REFERENCES todos(id),
      position INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Backward-compatible migration for existing databases.
  const groupColumns = sqlite.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!groupColumns.some((col) => col.name === "deleted_at")) {
    sqlite.exec("ALTER TABLE groups ADD COLUMN deleted_at TEXT");
  }

  const todoColumns = sqlite.prepare("PRAGMA table_info(todos)").all() as { name: string }[];
  if (!todoColumns.some((col) => col.name === "high_priority")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN high_priority INTEGER NOT NULL DEFAULT 0");
  }
  if (!todoColumns.some((col) => col.name === "reminder_at")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN reminder_at TEXT");
  }
  if (!todoColumns.some((col) => col.name === "completed_at")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN completed_at TEXT");
  }

  sqlite.close();
}

// Run migrations if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate.ts")) {
  console.log("Running migrations...");
  runMigrations();
  console.log("Migrations complete.");
}
