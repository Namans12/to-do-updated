import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createSqliteConnection, createDb } from "../db/connection.js";
import { runMigrations } from "../db/migrate.js";
import { createTestContext } from "./helpers.js";
import path from "path";
import os from "os";
import fs from "fs";

describe("Feature 6: Auto-Save & Data Persistence Guarantees", () => {
  describe("SQLite Pragmas", () => {
    let testDbPath: string;
    let sqlite: Database.Database;

    beforeEach(() => {
      testDbPath = path.join(
        os.tmpdir(),
        `nodes-todo-pragma-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );
      runMigrations(testDbPath);
      sqlite = createSqliteConnection(testDbPath);
    });

    afterEach(() => {
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
        // ignore
      }
    });

    it("should have WAL journal mode enabled", () => {
      const journalMode = sqlite.pragma("journal_mode", { simple: true });
      expect(journalMode).toBe("wal");
    });

    it("should have synchronous set to NORMAL (1)", () => {
      const sync = sqlite.pragma("synchronous", { simple: true });
      expect(sync).toBe(1);
    });

    it("should have foreign keys enforced", () => {
      const fk = sqlite.pragma("foreign_keys", { simple: true });
      expect(fk).toBe(1);
    });

    it("should enforce foreign key constraints at runtime", () => {
      const db = drizzle(sqlite, { schema });

      // Attempt to insert a todo with a non-existent group_id should throw
      expect(() => {
        db.insert(schema.todos)
          .values({
            id: "test-todo-fk",
            group_id: "non-existent-group",
            title: "Test",
            is_completed: 0,
            position: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .run();
      }).toThrow();
    });

    it("should set pragmas on every new connection", () => {
      // Create a second connection to the same DB
      const sqlite2 = createSqliteConnection(testDbPath);

      const journalMode = sqlite2.pragma("journal_mode", { simple: true });
      const sync = sqlite2.pragma("synchronous", { simple: true });
      const fk = sqlite2.pragma("foreign_keys", { simple: true });

      expect(journalMode).toBe("wal");
      expect(sync).toBe(1);
      expect(fk).toBe(1);

      sqlite2.close();
    });
  });

  describe("Data Persistence (survives close + reopen)", () => {
    let testDbPath: string;

    beforeEach(() => {
      testDbPath = path.join(
        os.tmpdir(),
        `nodes-todo-persist-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );
      runMigrations(testDbPath);
    });

    afterEach(() => {
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
        if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
      } catch {
        // ignore
      }
    });

    it("should persist a group after close and reopen", () => {
      // Session 1: create data
      const sqlite1 = createSqliteConnection(testDbPath);
      const db1 = drizzle(sqlite1, { schema });
      const now = new Date().toISOString();

      db1.insert(schema.groups)
        .values({
          id: "persist-group-1",
          name: "Persistent Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Close connection (simulates process shutdown)
      sqlite1.close();

      // Session 2: reopen and verify
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      const group = db2
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, "persist-group-1"))
        .get();

      expect(group).toBeDefined();
      expect(group!.name).toBe("Persistent Group");
      expect(group!.position).toBe(0);

      sqlite2.close();
    });

    it("should persist a todo after close and reopen", () => {
      // Session 1: create group and todo
      const sqlite1 = createSqliteConnection(testDbPath);
      const db1 = drizzle(sqlite1, { schema });
      const now = new Date().toISOString();

      db1.insert(schema.groups)
        .values({
          id: "persist-group-2",
          name: "Todo Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      db1.insert(schema.todos)
        .values({
          id: "persist-todo-1",
          group_id: "persist-group-2",
          title: "Buy groceries",
          description: "Milk, eggs, bread",
          is_completed: 0,
          position: 0,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Close connection
      sqlite1.close();

      // Session 2: reopen and verify
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      const todo = db2
        .select()
        .from(schema.todos)
        .where(eq(schema.todos.id, "persist-todo-1"))
        .get();

      expect(todo).toBeDefined();
      expect(todo!.title).toBe("Buy groceries");
      expect(todo!.description).toBe("Milk, eggs, bread");
      expect(todo!.is_completed).toBe(0);
      expect(todo!.group_id).toBe("persist-group-2");

      sqlite2.close();
    });

    it("should persist todo completion status after close and reopen", () => {
      // Session 1: create and complete a todo
      const sqlite1 = createSqliteConnection(testDbPath);
      const db1 = drizzle(sqlite1, { schema });
      const now = new Date().toISOString();

      db1.insert(schema.groups)
        .values({
          id: "persist-group-3",
          name: "Completion Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      db1.insert(schema.todos)
        .values({
          id: "persist-todo-2",
          group_id: "persist-group-3",
          title: "Completed task",
          is_completed: 0,
          position: 0,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Mark as completed
      db1.update(schema.todos)
        .set({ is_completed: 1, updated_at: new Date().toISOString() })
        .where(eq(schema.todos.id, "persist-todo-2"))
        .run();

      sqlite1.close();

      // Session 2: verify completion persisted
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      const todo = db2
        .select()
        .from(schema.todos)
        .where(eq(schema.todos.id, "persist-todo-2"))
        .get();

      expect(todo).toBeDefined();
      expect(todo!.is_completed).toBe(1);

      sqlite2.close();
    });

    it("should persist connections and connection_items after close and reopen", () => {
      // Session 1: create connection with items
      const sqlite1 = createSqliteConnection(testDbPath);
      const db1 = drizzle(sqlite1, { schema });
      const now = new Date().toISOString();

      db1.insert(schema.groups)
        .values({
          id: "persist-group-4",
          name: "Connection Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      db1.insert(schema.todos)
        .values([
          {
            id: "persist-todo-3",
            group_id: "persist-group-4",
            title: "Task A",
            is_completed: 0,
            position: 0,
            deleted_at: null,
            created_at: now,
            updated_at: now,
          },
          {
            id: "persist-todo-4",
            group_id: "persist-group-4",
            title: "Task B",
            is_completed: 1,
            position: 1,
            deleted_at: null,
            created_at: now,
            updated_at: now,
          },
        ])
        .run();

      db1.insert(schema.connections)
        .values({
          id: "persist-conn-1",
          name: "Related Tasks",
          created_at: now,
        })
        .run();

      db1.insert(schema.connectionItems)
        .values([
          {
            id: "persist-ci-1",
            connection_id: "persist-conn-1",
            todo_id: "persist-todo-3",
            position: 0,
          },
          {
            id: "persist-ci-2",
            connection_id: "persist-conn-1",
            todo_id: "persist-todo-4",
            position: 1,
          },
        ])
        .run();

      sqlite1.close();

      // Session 2: verify everything persisted
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      const conn = db2
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.id, "persist-conn-1"))
        .get();

      expect(conn).toBeDefined();
      expect(conn!.name).toBe("Related Tasks");

      const items = db2
        .select()
        .from(schema.connectionItems)
        .where(eq(schema.connectionItems.connection_id, "persist-conn-1"))
        .all();

      expect(items).toHaveLength(2);

      sqlite2.close();
    });

    it("should persist soft-delete status after close and reopen", () => {
      // Session 1: create and soft-delete a todo
      const sqlite1 = createSqliteConnection(testDbPath);
      const db1 = drizzle(sqlite1, { schema });
      const now = new Date().toISOString();

      db1.insert(schema.groups)
        .values({
          id: "persist-group-5",
          name: "Soft Delete Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      db1.insert(schema.todos)
        .values({
          id: "persist-todo-5",
          group_id: "persist-group-5",
          title: "To be deleted",
          is_completed: 0,
          position: 0,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Soft-delete
      const deleteTime = new Date().toISOString();
      db1.update(schema.todos)
        .set({ deleted_at: deleteTime, updated_at: deleteTime })
        .where(eq(schema.todos.id, "persist-todo-5"))
        .run();

      sqlite1.close();

      // Session 2: verify soft-delete persisted
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      const todo = db2
        .select()
        .from(schema.todos)
        .where(eq(schema.todos.id, "persist-todo-5"))
        .get();

      expect(todo).toBeDefined();
      expect(todo!.deleted_at).not.toBeNull();

      sqlite2.close();
    });
  });

  describe("Transaction Guarantees", () => {
    let ctx: ReturnType<typeof createTestContext>;

    beforeEach(() => {
      ctx = createTestContext();
    });

    afterEach(() => {
      ctx.cleanup();
    });

    it("should rollback group creation if transaction fails", () => {
      const { sqlite, db } = ctx;

      // Insert a group to establish a known state
      const now = new Date().toISOString();
      db.insert(schema.groups)
        .values({
          id: "txn-group-1",
          name: "Existing Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Try a transaction that fails midway
      try {
        const txn = sqlite.transaction(() => {
          db.insert(schema.groups)
            .values({
              id: "txn-group-2",
              name: "New Group",
              position: 1,
              created_at: now,
              updated_at: now,
            })
            .run();

          // Force error
          throw new Error("Simulated failure");
        });
        txn();
      } catch {
        // Expected
      }

      // Verify the second group was NOT created (rollback)
      const allGroups = db.select().from(schema.groups).all();
      expect(allGroups).toHaveLength(1);
      expect(allGroups[0].id).toBe("txn-group-1");
    });

    it("should rollback todo creation if transaction fails", () => {
      const { sqlite, db } = ctx;
      const now = new Date().toISOString();

      // Create a group first
      db.insert(schema.groups)
        .values({
          id: "txn-group-3",
          name: "Todo Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Try a transaction that creates a todo but then fails
      try {
        const txn = sqlite.transaction(() => {
          db.insert(schema.todos)
            .values({
              id: "txn-todo-1",
              group_id: "txn-group-3",
              title: "Should not persist",
              is_completed: 0,
              position: 0,
              deleted_at: null,
              created_at: now,
              updated_at: now,
            })
            .run();

          throw new Error("Simulated failure");
        });
        txn();
      } catch {
        // Expected
      }

      // Verify the todo was NOT created
      const allTodos = db.select().from(schema.todos).all();
      expect(allTodos).toHaveLength(0);
    });

    it("should atomically create group with correct position via API", async () => {
      const { app } = ctx;

      // Create multiple groups and verify positions are sequential
      const res1 = await app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "First" }),
      });
      const res2 = await app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Second" }),
      });
      const res3 = await app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Third" }),
      });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res3.status).toBe(201);

      const data1 = await res1.json();
      const data2 = await res2.json();
      const data3 = await res3.json();

      expect(data1.data.position).toBe(0);
      expect(data2.data.position).toBe(1);
      expect(data3.data.position).toBe(2);
    });

    it("should atomically create todo with correct position via API", async () => {
      const { app } = ctx;

      // Create a group first
      const groupRes = await app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Group" }),
      });
      const groupData = await groupRes.json();
      const groupId = groupData.data.id;

      // Create multiple todos
      const res1 = await app.request(`/api/groups/${groupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "first" }),
      });
      const res2 = await app.request(`/api/groups/${groupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "second" }),
      });
      const res3 = await app.request(`/api/groups/${groupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "third" }),
      });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res3.status).toBe(201);

      const data1 = await res1.json();
      const data2 = await res2.json();
      const data3 = await res3.json();

      expect(data1.data.position).toBe(0);
      expect(data2.data.position).toBe(1);
      expect(data3.data.position).toBe(2);
    });
  });

  describe("No In-Memory Caching", () => {
    let testDbPath: string;

    beforeEach(() => {
      testDbPath = path.join(
        os.tmpdir(),
        `nodes-todo-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );
      runMigrations(testDbPath);
    });

    afterEach(() => {
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
        if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
      } catch {
        // ignore
      }
    });

    it("should see changes made by a direct SQL write immediately on read", () => {
      // This verifies no stale caching layer exists between SQLite and the ORM
      const sqlite = createSqliteConnection(testDbPath);
      const db = drizzle(sqlite, { schema });
      const now = new Date().toISOString();

      // Insert via Drizzle ORM
      db.insert(schema.groups)
        .values({
          id: "cache-test-1",
          name: "ORM Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Modify directly via raw SQL (bypass ORM)
      sqlite.prepare("UPDATE groups SET name = ? WHERE id = ?").run("Modified Group", "cache-test-1");

      // Read via Drizzle ORM — should see the raw SQL change immediately
      const group = db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, "cache-test-1"))
        .get();

      expect(group).toBeDefined();
      expect(group!.name).toBe("Modified Group");

      sqlite.close();
    });

    it("should reflect deletes immediately without caching", () => {
      const sqlite = createSqliteConnection(testDbPath);
      const db = drizzle(sqlite, { schema });
      const now = new Date().toISOString();

      db.insert(schema.groups)
        .values({
          id: "cache-test-2",
          name: "To Delete",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Delete directly via raw SQL
      sqlite.prepare("DELETE FROM groups WHERE id = ?").run("cache-test-2");

      // Read via Drizzle ORM — should see the delete immediately
      const group = db
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, "cache-test-2"))
        .get();

      expect(group).toBeUndefined();

      sqlite.close();
    });
  });

  describe("Graceful Shutdown", () => {
    it("closeDb should properly close the database connection", () => {
      // Verify that createDb/closeDb pattern works
      const testDbPath = path.join(
        os.tmpdir(),
        `nodes-todo-shutdown-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );
      runMigrations(testDbPath);

      const { db, sqlite } = createDb(undefined, testDbPath);
      const now = new Date().toISOString();

      // Insert data
      db.insert(schema.groups)
        .values({
          id: "shutdown-group-1",
          name: "Shutdown Test",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Close the connection
      sqlite.close();

      // Verify the connection is truly closed (operations should throw)
      expect(() => {
        db.select().from(schema.groups).all();
      }).toThrow();

      // But data should survive reopen
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      const group = db2
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, "shutdown-group-1"))
        .get();

      expect(group).toBeDefined();
      expect(group!.name).toBe("Shutdown Test");

      sqlite2.close();

      // Cleanup
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
        if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
      } catch {
        // ignore
      }
    });
  });

  describe("WAL Mode Durability", () => {
    let testDbPath: string;

    beforeEach(() => {
      testDbPath = path.join(
        os.tmpdir(),
        `nodes-todo-wal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );
      runMigrations(testDbPath);
    });

    afterEach(() => {
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
        if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
      } catch {
        // ignore
      }
    });

    it("should create WAL file when writing data", () => {
      const sqlite = createSqliteConnection(testDbPath);
      const db = drizzle(sqlite, { schema });
      const now = new Date().toISOString();

      db.insert(schema.groups)
        .values({
          id: "wal-test-1",
          name: "WAL Test Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // WAL file should exist (WAL mode creates it on write)
      const walExists = fs.existsSync(testDbPath + "-wal");
      const shmExists = fs.existsSync(testDbPath + "-shm");

      // At least one of these should exist in WAL mode
      expect(walExists || shmExists).toBe(true);

      sqlite.close();
    });

    it("should recover data after WAL checkpoint", () => {
      const sqlite1 = createSqliteConnection(testDbPath);
      const db1 = drizzle(sqlite1, { schema });
      const now = new Date().toISOString();

      db1.insert(schema.groups)
        .values({
          id: "wal-test-2",
          name: "Checkpoint Group",
          position: 0,
          created_at: now,
          updated_at: now,
        })
        .run();

      // Force a WAL checkpoint (flushes WAL to main DB file)
      sqlite1.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      sqlite1.close();

      // Reopen and verify data survives
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      const group = db2
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, "wal-test-2"))
        .get();

      expect(group).toBeDefined();
      expect(group!.name).toBe("Checkpoint Group");

      sqlite2.close();
    });
  });

  describe("End-to-End Persistence via API", () => {
    it("should persist data created via API endpoints after close and reopen", async () => {
      const testDbPath = path.join(
        os.tmpdir(),
        `nodes-todo-e2e-persist-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );
      runMigrations(testDbPath);

      // Session 1: create data via API
      const sqlite1 = createSqliteConnection(testDbPath);
      const db1 = drizzle(sqlite1, { schema });
      const dbOverride1 = { db: db1, sqlite: sqlite1 };

      const { createApp } = await import("../app.js");
      const app1 = createApp(dbOverride1);

      // Create a group via API
      const groupRes = await app1.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "API Persist Group" }),
      });
      expect(groupRes.status).toBe(201);
      const groupData = await groupRes.json();
      const groupId = groupData.data.id;

      // Create a todo via API
      const todoRes = await app1.request(`/api/groups/${groupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "API persist task", description: "Should survive restart" }),
      });
      expect(todoRes.status).toBe(201);
      const todoData = await todoRes.json();
      const todoId = todoData.data.id;

      // Complete the todo via API
      const completeRes = await app1.request(`/api/todos/${todoId}/complete`, {
        method: "PATCH",
      });
      expect(completeRes.status).toBe(200);

      // Close connection (simulates process shutdown)
      sqlite1.close();

      // Session 2: reopen and verify via fresh DB connection
      const sqlite2 = createSqliteConnection(testDbPath);
      const db2 = drizzle(sqlite2, { schema });

      // Verify group persisted
      const group = db2
        .select()
        .from(schema.groups)
        .where(eq(schema.groups.id, groupId))
        .get();
      expect(group).toBeDefined();
      expect(group!.name).toBe("API Persist Group");

      // Verify todo persisted with completion status
      const todo = db2
        .select()
        .from(schema.todos)
        .where(eq(schema.todos.id, todoId))
        .get();
      expect(todo).toBeDefined();
      expect(todo!.title).toBe("API persist task");
      expect(todo!.description).toBe("Should survive restart");
      expect(todo!.is_completed).toBe(1);

      sqlite2.close();

      // Cleanup
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
        if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
      } catch {
        // ignore
      }
    });
  });
});
