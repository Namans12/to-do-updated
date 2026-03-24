import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import { runMigrations } from "../db/migrate.js";
import { createSqliteConnection } from "../db/connection.js";
import path from "path";
import fs from "fs";
import os from "os";

describe("Database Setup", () => {
  let testDbPath: string;
  let sqlite: Database.Database;

  beforeAll(() => {
    // Use a temp directory for test DB
    testDbPath = path.join(os.tmpdir(), `nodes-todo-test-${Date.now()}.db`);
    runMigrations(testDbPath);
    sqlite = createSqliteConnection(testDbPath);
  });

  afterAll(() => {
    sqlite.close();
    // Clean up test DB files
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
      if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create the groups table", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='groups'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("should create the todos table", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='todos'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("should create the connections table", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connections'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("should create the connection_items table", () => {
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connection_items'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("should have WAL journal mode enabled", () => {
    const journalMode = sqlite.pragma("journal_mode", { simple: true });
    expect(journalMode).toBe("wal");
  });

  it("should have foreign keys enabled", () => {
    const fk = sqlite.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
  });

  it("should have synchronous set to NORMAL (1)", () => {
    const sync = sqlite.pragma("synchronous", { simple: true });
    expect(sync).toBe(1);
  });

  it("groups table should have correct columns", () => {
    const columns = sqlite.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("position");
    expect(columnNames).toContain("deleted_at");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("updated_at");
  });

  it("todos table should have correct columns", () => {
    const columns = sqlite.prepare("PRAGMA table_info(todos)").all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("group_id");
    expect(columnNames).toContain("title");
    expect(columnNames).toContain("description");
    expect(columnNames).toContain("high_priority");
    expect(columnNames).toContain("reminder_at");
    expect(columnNames).toContain("is_completed");
    expect(columnNames).toContain("completed_at");
    expect(columnNames).toContain("position");
    expect(columnNames).toContain("deleted_at");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("updated_at");
  });

  it("connections table should have correct columns", () => {
    const columns = sqlite.prepare("PRAGMA table_info(connections)").all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("created_at");
  });

  it("connection_items table should have correct columns", () => {
    const columns = sqlite.prepare("PRAGMA table_info(connection_items)").all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("connection_id");
    expect(columnNames).toContain("todo_id");
    expect(columnNames).toContain("parent_todo_id");
    expect(columnNames).toContain("position");
  });

  it("should enforce a unique todo_id index on connection_items", () => {
    const indexes = sqlite.prepare("PRAGMA index_list(connection_items)").all() as {
      name: string;
      unique: number;
    }[];
    expect(
      indexes.some((index) => index.name === "idx_connection_items_todo_id_unique" && index.unique === 1)
    ).toBe(true);
  });

  it("should be able to use Drizzle ORM with the database", () => {
    const db = drizzle(sqlite, { schema });
    // Simple query to verify Drizzle works
    const result = db.select().from(schema.groups).all();
    expect(result).toEqual([]);
  });

  it("migrations should be idempotent (safe to run multiple times)", () => {
    // Running migrations again should not throw
    expect(() => runMigrations(testDbPath)).not.toThrow();
  });
});
