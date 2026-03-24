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
      recurrence_rule TEXT,
      recurrence_enabled INTEGER NOT NULL DEFAULT 0,
      next_occurrence_at TEXT,
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
      kind TEXT NOT NULL DEFAULT 'sequence',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_items (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id),
      todo_id TEXT NOT NULL REFERENCES todos(id),
      parent_todo_id TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
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
  if (!todoColumns.some((col) => col.name === "recurrence_rule")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN recurrence_rule TEXT");
  }
  if (!todoColumns.some((col) => col.name === "recurrence_enabled")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN recurrence_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!todoColumns.some((col) => col.name === "next_occurrence_at")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN next_occurrence_at TEXT");
  }
  if (!todoColumns.some((col) => col.name === "completed_at")) {
    sqlite.exec("ALTER TABLE todos ADD COLUMN completed_at TEXT");
  }
  const connectionColumns = sqlite.prepare("PRAGMA table_info(connections)").all() as { name: string }[];
  if (!connectionColumns.some((col) => col.name === "kind")) {
    sqlite.exec("ALTER TABLE connections ADD COLUMN kind TEXT NOT NULL DEFAULT 'sequence'");
  }
  const connectionItemColumns = sqlite.prepare("PRAGMA table_info(connection_items)").all() as { name: string }[];
  if (!connectionItemColumns.some((col) => col.name === "parent_todo_id")) {
    sqlite.exec("ALTER TABLE connection_items ADD COLUMN parent_todo_id TEXT");
  }

  // Normalize legacy connection memberships so one todo can belong to only one connection.
  const duplicateTodoIds = sqlite
    .prepare(
      `
        SELECT todo_id
        FROM connection_items
        GROUP BY todo_id
        HAVING COUNT(*) > 1
      `
    )
    .all() as { todo_id: string }[];

  for (const { todo_id } of duplicateTodoIds) {
    const memberships = sqlite
      .prepare(
        `
          SELECT ci.id
          FROM connection_items ci
          INNER JOIN connections c ON c.id = ci.connection_id
          WHERE ci.todo_id = ?
          ORDER BY c.created_at ASC, ci.position ASC, ci.id ASC
        `
      )
      .all(todo_id) as { id: string }[];

    const idsToDelete = memberships.slice(1).map((row) => row.id);
    for (const id of idsToDelete) {
      sqlite.prepare("DELETE FROM connection_items WHERE id = ?").run(id);
    }
  }

  const connectionRows = sqlite.prepare("SELECT id FROM connections").all() as { id: string }[];
  for (const { id } of connectionRows) {
    const items = sqlite
      .prepare(
        `
          SELECT id
          FROM connection_items
          WHERE connection_id = ?
          ORDER BY position ASC, id ASC
        `
      )
      .all(id) as { id: string }[];

    if (items.length < 2) {
      sqlite.prepare("DELETE FROM connection_items WHERE connection_id = ?").run(id);
      sqlite.prepare("DELETE FROM connections WHERE id = ?").run(id);
      continue;
    }

    for (let position = 0; position < items.length; position += 1) {
      sqlite
        .prepare("UPDATE connection_items SET position = ? WHERE id = ?")
        .run(position, items[position]!.id);
    }
  }

  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_items_todo_id_unique
    ON connection_items(todo_id)
  `);

  sqlite.close();
}

// Run migrations if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migrate.ts")) {
  console.log("Running migrations...");
  runMigrations();
  console.log("Migrations complete.");
}
