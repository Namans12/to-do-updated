import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import path from "path";
import fs from "fs";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "todos.db");

export type AppDatabase = BetterSQLite3Database<typeof schema>;
export type SqliteConnection = SqliteDatabase;

export interface DbContext {
  db: AppDatabase;
  sqlite: SqliteConnection;
}

export function createSqliteConnection(dbPath: string = DEFAULT_DB_PATH): SqliteConnection {
  // Ensure the data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);

  // Set pragmas for durability and performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  return sqlite;
}

export function createDb(sqliteConnection?: SqliteConnection, dbPath?: string): DbContext {
  const sqlite = sqliteConnection ?? createSqliteConnection(dbPath);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

// Singleton for the main app
let _db: DbContext | null = null;

export function getDb(dbPath?: string): DbContext {
  if (!_db) {
    _db = createDb(undefined, dbPath);
  }
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.sqlite.close();
    _db = null;
  }
}
