import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { runMigrations } from "../db/migrate.js";
import { createSqliteConnection } from "../db/connection.js";
import { createApp } from "../app.js";
import path from "path";
import os from "os";
import fs from "fs";
import type { AppDatabase, DbContext, SqliteConnection } from "../db/connection.js";

export interface TestContext {
  app: ReturnType<typeof createApp>;
  db: AppDatabase;
  sqlite: SqliteConnection;
  dbOverride: DbContext;
  testDbPath: string;
  cleanup: () => void;
}

export function createTestContext(): TestContext {
  const testDbPath = path.join(os.tmpdir(), `nodes-todo-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

  // Run migrations to create tables
  runMigrations(testDbPath);

  // Create a connection for the test
  const sqlite = createSqliteConnection(testDbPath);
  const db = drizzle(sqlite, { schema });
  const dbOverride = { db, sqlite };

  // Create app with the test db
  const app = createApp(dbOverride);

  function cleanup() {
    try {
      sqlite.close();
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
      if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
    } catch {
      // Ignore cleanup errors
    }
  }

  return { app, db, sqlite, dbOverride, testDbPath, cleanup };
}
