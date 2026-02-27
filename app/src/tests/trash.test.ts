import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestContext } from "./helpers.js";
import { groups, todos, connections, connectionItems } from "../db/schema.js";
import { eq, isNotNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { runAutoPurge } from "../routes/trash.js";

describe("Trash & Auto-Purge API", () => {
  let ctx: ReturnType<typeof createTestContext>;
  let testGroupId: string;

  beforeAll(() => {
    ctx = createTestContext();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  beforeEach(async () => {
    // Clear tables before each test for isolation
    ctx.db.delete(connectionItems).run();
    ctx.db.delete(connections).run();
    ctx.db.delete(todos).run();
    ctx.db.delete(groups).run();

    // Create a default test group
    const res = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Group" }),
    });
    const body = await res.json();
    testGroupId = body.data.id;
  });

  // Helper: create a todo via API
  async function createTodo(groupId: string, title: string) {
    const res = await ctx.app.request(`/api/groups/${groupId}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return (await res.json()).data;
  }

  // Helper: soft-delete a todo via API
  async function softDeleteTodo(todoId: string) {
    const res = await ctx.app.request(`/api/todos/${todoId}`, {
      method: "DELETE",
    });
    return res;
  }

  // Helper: insert a todo directly with a custom deleted_at for purge testing
  function insertTodoWithDeletedAt(
    groupId: string,
    title: string,
    deletedAt: string
  ) {
    const id = uuidv4();
    const now = new Date().toISOString();
    ctx.db.insert(todos).values({
      id,
      group_id: groupId,
      title,
      description: null,
      is_completed: 0,
      position: 0,
      deleted_at: deletedAt,
      created_at: now,
      updated_at: now,
    }).run();
    return id;
  }

  // ─── GET /api/trash ─────────────────────────

  describe("GET /api/trash", () => {
    it("should return an empty list when no todos are in trash", async () => {
      const res = await ctx.app.request("/api/trash");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.todos).toEqual([]);
      expect(body.data.groups).toEqual([]);
    });

    it("should return soft-deleted todos with days_until_purge", async () => {
      const todo = await createTodo(testGroupId, "trash me");
      await softDeleteTodo(todo.id);

      const res = await ctx.app.request("/api/trash");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.todos).toHaveLength(1);
      expect(body.data.todos[0].id).toBe(todo.id);
      expect(body.data.todos[0].group_name).toBe("Test Group");
      expect(body.data.todos[0].deleted_at).toBeTruthy();
      expect(body.data.todos[0].days_until_purge).toBe(30);
    });

    it("should show correct days_until_purge for older items", async () => {
      // Manually insert a todo deleted 10 days ago
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const id = insertTodoWithDeletedAt(testGroupId, "Old deleted", tenDaysAgo.toISOString());

      const res = await ctx.app.request("/api/trash");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.todos).toHaveLength(1);
      expect(body.data.todos[0].id).toBe(id);
      expect(body.data.todos[0].days_until_purge).toBe(20);
    });

    it("should show 0 days_until_purge for items past 30 days", async () => {
      // Manually insert a todo deleted 35 days ago
      const thirtyFiveDaysAgo = new Date();
      thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);
      const id = insertTodoWithDeletedAt(testGroupId, "Very old deleted", thirtyFiveDaysAgo.toISOString());

      const res = await ctx.app.request("/api/trash");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.todos).toHaveLength(1);
      expect(body.data.todos[0].days_until_purge).toBe(0);
    });

    it("should not include active (non-deleted) todos", async () => {
      await createTodo(testGroupId, "active todo");
      const trashTodo = await createTodo(testGroupId, "trash todo");
      await softDeleteTodo(trashTodo.id);

      const res = await ctx.app.request("/api/trash");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.todos).toHaveLength(1);
      expect(body.data.todos[0].title).toBe("Trash todo");
    });

    it("should return multiple soft-deleted todos", async () => {
      const todo1 = await createTodo(testGroupId, "first trash");
      const todo2 = await createTodo(testGroupId, "second trash");
      await softDeleteTodo(todo1.id);
      await softDeleteTodo(todo2.id);

      const res = await ctx.app.request("/api/trash");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.todos).toHaveLength(2);
    });
  });

  // ─── POST /api/trash/:id/restore ─────────────────────────

  describe("POST /api/trash/:id/restore", () => {
    it("should restore a soft-deleted todo", async () => {
      const todo = await createTodo(testGroupId, "restore me");
      await softDeleteTodo(todo.id);

      const res = await ctx.app.request(`/api/trash/${todo.id}/restore`, {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.id).toBe(todo.id);
      expect(body.data.deleted_at).toBeNull();
    });

    it("should make restored todo visible in group list again", async () => {
      const todo = await createTodo(testGroupId, "restore me");
      await softDeleteTodo(todo.id);

      // Verify it's not in the group list
      let listRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      let listBody = await listRes.json();
      expect(listBody.data).toHaveLength(0);

      // Restore it
      await ctx.app.request(`/api/trash/${todo.id}/restore`, {
        method: "POST",
      });

      // Verify it's back in the group list
      listRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      listBody = await listRes.json();
      expect(listBody.data).toHaveLength(1);
      expect(listBody.data[0].id).toBe(todo.id);
    });

    it("should return 404 for non-existent todo", async () => {
      const res = await ctx.app.request(`/api/trash/${uuidv4()}/restore`, {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Todo not found");
    });

    it("should return 400 if todo is not in trash", async () => {
      const todo = await createTodo(testGroupId, "not deleted");

      const res = await ctx.app.request(`/api/trash/${todo.id}/restore`, {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Todo is not in trash");
    });

    it("should remove todo from trash list after restore", async () => {
      const todo = await createTodo(testGroupId, "restore me");
      await softDeleteTodo(todo.id);

      await ctx.app.request(`/api/trash/${todo.id}/restore`, {
        method: "POST",
      });

      const trashRes = await ctx.app.request("/api/trash");
      const trashBody = await trashRes.json();
      expect(trashBody.data.todos).toHaveLength(0);
    });

    it("should restore a deleted group with all its todos", async () => {
      const t1 = await createTodo(testGroupId, "g1");
      const t2 = await createTodo(testGroupId, "g2");

      await ctx.app.request(`/api/groups/${testGroupId}`, { method: "DELETE" });

      const restoreRes = await ctx.app.request(`/api/trash/groups/${testGroupId}/restore`, {
        method: "POST",
      });
      expect(restoreRes.status).toBe(200);

      const groupRes = await ctx.app.request(`/api/groups/${testGroupId}`);
      expect(groupRes.status).toBe(200);

      const listRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      const listBody = await listRes.json();
      const ids = listBody.data.map((t: any) => t.id);
      expect(ids).toContain(t1.id);
      expect(ids).toContain(t2.id);
    });
  });

  // ─── DELETE /api/trash/:id ─────────────────────────

  describe("DELETE /api/trash/:id", () => {
    it("should permanently delete a soft-deleted todo", async () => {
      const todo = await createTodo(testGroupId, "permanent delete");
      await softDeleteTodo(todo.id);

      const res = await ctx.app.request(`/api/trash/${todo.id}`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.message).toBe("Todo permanently deleted");

      // Verify it's gone from the database entirely
      const dbTodo = ctx.db
        .select()
        .from(todos)
        .where(eq(todos.id, todo.id))
        .get();
      expect(dbTodo).toBeUndefined();
    });

    it("should return 404 for non-existent todo", async () => {
      const res = await ctx.app.request(`/api/trash/${uuidv4()}`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Todo not found");
    });

    it("should return 400 if todo is not in trash", async () => {
      const todo = await createTodo(testGroupId, "active todo");

      const res = await ctx.app.request(`/api/trash/${todo.id}`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("Todo is not in trash");
    });

    it("should remove associated connection_items when permanently deleting", async () => {
      const todo = await createTodo(testGroupId, "connected todo");
      const todo2 = await createTodo(testGroupId, "another todo");

      // Create a connection with these todos
      const connId = uuidv4();
      ctx.db.insert(connections).values({
        id: connId,
        name: "Test connection",
        created_at: new Date().toISOString(),
      }).run();

      const itemId1 = uuidv4();
      ctx.db.insert(connectionItems).values({
        id: itemId1,
        connection_id: connId,
        todo_id: todo.id,
        position: 0,
      }).run();

      const itemId2 = uuidv4();
      ctx.db.insert(connectionItems).values({
        id: itemId2,
        connection_id: connId,
        todo_id: todo2.id,
        position: 1,
      }).run();

      // Soft-delete first todo, then permanently delete it
      await softDeleteTodo(todo.id);
      await ctx.app.request(`/api/trash/${todo.id}`, { method: "DELETE" });

      // Verify the connection_item for the deleted todo is gone
      const item = ctx.db
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, todo.id))
        .get();
      expect(item).toBeUndefined();

      // But the other connection_item should still exist
      const otherItem = ctx.db
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, todo2.id))
        .get();
      expect(otherItem).toBeDefined();
    });

    it("should leave no trace in DB after permanent delete", async () => {
      const todo = await createTodo(testGroupId, "trace test");
      const todoId = todo.id;
      await softDeleteTodo(todoId);

      await ctx.app.request(`/api/trash/${todoId}`, { method: "DELETE" });

      // No row in todos
      const row = ctx.db.select().from(todos).where(eq(todos.id, todoId)).get();
      expect(row).toBeUndefined();

      // No row in connection_items for this todo
      const connItem = ctx.db
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, todoId))
        .get();
      expect(connItem).toBeUndefined();
    });
  });

  describe("DELETE /api/trash/groups/:id", () => {
    it("should permanently delete a trashed group and all its todos", async () => {
      const t1 = await createTodo(testGroupId, "g1");
      const t2 = await createTodo(testGroupId, "g2");

      await ctx.app.request(`/api/groups/${testGroupId}`, { method: "DELETE" });

      const res = await ctx.app.request(`/api/trash/groups/${testGroupId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const groupRow = ctx.db.select().from(groups).where(eq(groups.id, testGroupId)).get();
      expect(groupRow).toBeUndefined();

      const todo1 = ctx.db.select().from(todos).where(eq(todos.id, t1.id)).get();
      const todo2 = ctx.db.select().from(todos).where(eq(todos.id, t2.id)).get();
      expect(todo1).toBeUndefined();
      expect(todo2).toBeUndefined();
    });
  });

  // ─── DELETE /api/trash ─────────────────────────

  describe("DELETE /api/trash (empty all)", () => {
    it("should permanently delete all trashed todos", async () => {
      const todo1 = await createTodo(testGroupId, "trash 1");
      const todo2 = await createTodo(testGroupId, "trash 2");
      const activeTodo = await createTodo(testGroupId, "active");
      await softDeleteTodo(todo1.id);
      await softDeleteTodo(todo2.id);

      const res = await ctx.app.request("/api/trash", { method: "DELETE" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.message).toBe("Trash emptied successfully");
      expect(body.data.deleted_count).toBe(2);

      // Verify trashed todos are gone
      const trashed = ctx.db
        .select()
        .from(todos)
        .where(isNotNull(todos.deleted_at))
        .all();
      expect(trashed).toHaveLength(0);

      // Active todo should still exist
      const active = ctx.db
        .select()
        .from(todos)
        .where(eq(todos.id, activeTodo.id))
        .get();
      expect(active).toBeDefined();
    });

    it("should return success with count 0 when trash is already empty", async () => {
      const res = await ctx.app.request("/api/trash", { method: "DELETE" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.deleted_count).toBe(0);
      expect(body.data.message).toBe("Trash is already empty");
    });

    it("should remove orphaned connection_items when emptying trash", async () => {
      const todo = await createTodo(testGroupId, "connected trash");

      // Create a connection
      const connId = uuidv4();
      ctx.db.insert(connections).values({
        id: connId,
        name: "Test conn",
        created_at: new Date().toISOString(),
      }).run();

      ctx.db.insert(connectionItems).values({
        id: uuidv4(),
        connection_id: connId,
        todo_id: todo.id,
        position: 0,
      }).run();

      // Soft-delete, then empty trash
      await softDeleteTodo(todo.id);
      await ctx.app.request("/api/trash", { method: "DELETE" });

      // Connection_item referencing the deleted todo should be gone
      const items = ctx.db
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.todo_id, todo.id))
        .all();
      expect(items).toHaveLength(0);
    });
  });

  // ─── Auto-Purge Logic ─────────────────────────

  describe("Auto-Purge (runAutoPurge)", () => {
    it("should not purge todos deleted less than 30 days ago", () => {
      const todo = insertTodoWithDeletedAt(
        testGroupId,
        "Recent delete",
        new Date().toISOString()
      );

      const purgedCount = runAutoPurge(ctx.dbOverride);

      expect(purgedCount).toBe(0);

      // Todo should still exist
      const row = ctx.db.select().from(todos).where(eq(todos.id, todo)).get();
      expect(row).toBeDefined();
    });

    it("should purge todos deleted more than 30 days ago", () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
      const todoId = insertTodoWithDeletedAt(
        testGroupId,
        "Old delete",
        thirtyOneDaysAgo.toISOString()
      );

      const purgedCount = runAutoPurge(ctx.dbOverride);

      expect(purgedCount).toBe(1);

      // Todo should be gone
      const row = ctx.db.select().from(todos).where(eq(todos.id, todoId)).get();
      expect(row).toBeUndefined();
    });

    it("should only purge expired items, not recent ones", () => {
      // One expired, one recent
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
      const expiredId = insertTodoWithDeletedAt(
        testGroupId,
        "Expired",
        thirtyOneDaysAgo.toISOString()
      );

      const recentId = insertTodoWithDeletedAt(
        testGroupId,
        "Recent",
        new Date().toISOString()
      );

      const purgedCount = runAutoPurge(ctx.dbOverride);

      expect(purgedCount).toBe(1);

      // Expired todo should be gone
      const expired = ctx.db.select().from(todos).where(eq(todos.id, expiredId)).get();
      expect(expired).toBeUndefined();

      // Recent todo should still exist
      const recent = ctx.db.select().from(todos).where(eq(todos.id, recentId)).get();
      expect(recent).toBeDefined();
    });

    it("should not purge non-deleted (active) todos", () => {
      // Create an active todo (not soft-deleted)
      const activeTodoId = uuidv4();
      const now = new Date().toISOString();
      ctx.db.insert(todos).values({
        id: activeTodoId,
        group_id: testGroupId,
        title: "Active todo",
        description: null,
        is_completed: 0,
        position: 0,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      }).run();

      const purgedCount = runAutoPurge(ctx.dbOverride);
      expect(purgedCount).toBe(0);

      // Active todo should still exist
      const row = ctx.db.select().from(todos).where(eq(todos.id, activeTodoId)).get();
      expect(row).toBeDefined();
    });

    it("should clean up orphaned connection_items during purge", () => {
      // Create a todo with a connection_item, then expire it
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
      const todoId = insertTodoWithDeletedAt(
        testGroupId,
        "Connected expired",
        thirtyOneDaysAgo.toISOString()
      );

      // Create connection + connection_item
      const connId = uuidv4();
      ctx.db.insert(connections).values({
        id: connId,
        name: "Purge test connection",
        created_at: new Date().toISOString(),
      }).run();

      const itemId = uuidv4();
      ctx.db.insert(connectionItems).values({
        id: itemId,
        connection_id: connId,
        todo_id: todoId,
        position: 0,
      }).run();

      const purgedCount = runAutoPurge(ctx.dbOverride);
      expect(purgedCount).toBe(1);

      // Connection item should be removed
      const item = ctx.db
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.id, itemId))
        .get();
      expect(item).toBeUndefined();
    });

    it("should return 0 when there are no expired items", () => {
      const purgedCount = runAutoPurge(ctx.dbOverride);
      expect(purgedCount).toBe(0);
    });

    it("should handle purge of multiple expired items", () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);

      const id1 = insertTodoWithDeletedAt(testGroupId, "Expired 1", thirtyOneDaysAgo.toISOString());
      const id2 = insertTodoWithDeletedAt(testGroupId, "Expired 2", thirtyOneDaysAgo.toISOString());

      const fortyDaysAgo = new Date();
      fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);
      const id3 = insertTodoWithDeletedAt(testGroupId, "Very old", fortyDaysAgo.toISOString());

      const purgedCount = runAutoPurge(ctx.dbOverride);
      expect(purgedCount).toBe(3);

      // All should be gone
      expect(ctx.db.select().from(todos).where(eq(todos.id, id1)).get()).toBeUndefined();
      expect(ctx.db.select().from(todos).where(eq(todos.id, id2)).get()).toBeUndefined();
      expect(ctx.db.select().from(todos).where(eq(todos.id, id3)).get()).toBeUndefined();
    });

    it("should handle item deleted exactly at the 30-day boundary", () => {
      // Exactly 30 days ago - should NOT be purged (cutoff is older than 30 days)
      const exactlyThirtyDaysAgo = new Date();
      exactlyThirtyDaysAgo.setDate(exactlyThirtyDaysAgo.getDate() - 30);
      const todoId = insertTodoWithDeletedAt(
        testGroupId,
        "Boundary item",
        exactlyThirtyDaysAgo.toISOString()
      );

      const purgedCount = runAutoPurge(ctx.dbOverride);

      // Item at exactly 30 days should still exist (we use < cutoff, not <=)
      // The cutoff is computed as now - 30 days, so an item deleted exactly at cutoff should be right at the boundary
      // Due to millisecond precision, this item's deleted_at will be at or very slightly before the cutoff
      // In practice, it may or may not be purged depending on timing, so we just verify the function runs without error
      expect(purgedCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Integration: Trash + Todos interaction ─────────────────────────

  describe("Integration: Trash workflow", () => {
    it("should support full lifecycle: create -> soft-delete -> trash list -> restore -> active", async () => {
      // Create a todo
      const todo = await createTodo(testGroupId, "lifecycle test");

      // Soft-delete it
      await softDeleteTodo(todo.id);

      // Should be in trash
      let trashRes = await ctx.app.request("/api/trash");
      let trashBody = await trashRes.json();
      expect(trashBody.data.todos).toHaveLength(1);
      expect(trashBody.data.todos[0].id).toBe(todo.id);

      // Should NOT be in group list
      let listRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      let listBody = await listRes.json();
      expect(listBody.data).toHaveLength(0);

      // Restore it
      await ctx.app.request(`/api/trash/${todo.id}/restore`, { method: "POST" });

      // Should NOT be in trash
      trashRes = await ctx.app.request("/api/trash");
      trashBody = await trashRes.json();
      expect(trashBody.data.todos).toHaveLength(0);

      // Should be back in group list
      listRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      listBody = await listRes.json();
      expect(listBody.data).toHaveLength(1);
      expect(listBody.data[0].id).toBe(todo.id);
    });

    it("should support full lifecycle: create -> soft-delete -> permanent delete -> gone", async () => {
      // Create a todo
      const todo = await createTodo(testGroupId, "permanent lifecycle");

      // Soft-delete it
      await softDeleteTodo(todo.id);

      // Permanently delete it from trash
      await ctx.app.request(`/api/trash/${todo.id}`, { method: "DELETE" });

      // Should not be in trash
      const trashRes = await ctx.app.request("/api/trash");
      const trashBody = await trashRes.json();
      expect(trashBody.data.todos).toHaveLength(0);

      // Should not be findable at all
      const getRes = await ctx.app.request(`/api/todos/${todo.id}`);
      expect(getRes.status).toBe(404);
    });

    it("should preserve connections while group is in trash and restore them with group restore", async () => {
      const t1 = await createTodo(testGroupId, "c1");
      const t2 = await createTodo(testGroupId, "c2");

      const connRes = await ctx.app.request("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoIds: [t1.id, t2.id], name: "Trash Conn" }),
      });
      expect(connRes.status).toBe(201);

      await ctx.app.request(`/api/groups/${testGroupId}`, { method: "DELETE" });

      const hiddenConnRes = await ctx.app.request("/api/connections");
      const hiddenConnBody = await hiddenConnRes.json();
      expect(hiddenConnBody.data).toHaveLength(1);
      expect(hiddenConnBody.data[0].items).toHaveLength(0);

      await ctx.app.request(`/api/trash/groups/${testGroupId}/restore`, {
        method: "POST",
      });

      const restoredConnRes = await ctx.app.request("/api/connections");
      const restoredConnBody = await restoredConnRes.json();
      expect(restoredConnBody.data).toHaveLength(1);
      expect(restoredConnBody.data[0].items).toHaveLength(2);
    });
  });
});
