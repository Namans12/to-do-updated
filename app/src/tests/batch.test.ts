import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestContext } from "./helpers.js";
import { groups, todos } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("Batch Operations API", () => {
  let ctx: ReturnType<typeof createTestContext>;
  let testGroupId: string;
  let testGroupId2: string;

  beforeAll(() => {
    ctx = createTestContext();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  beforeEach(async () => {
    // Clear tables before each test for isolation
    ctx.db.delete(todos).run();
    ctx.db.delete(groups).run();

    // Create two test groups for batch operations
    const res1 = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Group 1" }),
    });
    const body1 = await res1.json();
    testGroupId = body1.data.id;

    const res2 = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Group 2" }),
    });
    const body2 = await res2.json();
    testGroupId2 = body2.data.id;
  });

  // Helper to create a todo via API
  async function createTodo(
    groupId: string,
    title: string,
    description?: string
  ) {
    const payload: any = { title };
    if (description !== undefined) payload.description = description;

    const res = await ctx.app.request(`/api/groups/${groupId}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, body: await res.json() };
  }

  // Helper to soft-delete a todo via API
  async function deleteTodo(todoId: string) {
    return ctx.app.request(`/api/todos/${todoId}`, {
      method: "DELETE",
    });
  }

  // ─── POST /api/todos/batch/complete ─────────────────────────

  describe("POST /api/todos/batch/complete", () => {
    it("should complete multiple todos and return 200", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Todo 2");
      const { body: body3 } = await createTodo(testGroupId, "Todo 3");

      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, body2.data.id, body3.data.id] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(3);
      expect(result.data.skipped).toEqual([]);

      // Verify all todos are completed
      const todo1 = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      const todo2 = ctx.db.select().from(todos).where(eq(todos.id, body2.data.id)).get();
      const todo3 = ctx.db.select().from(todos).where(eq(todos.id, body3.data.id)).get();

      expect(todo1?.is_completed).toBe(1);
      expect(todo2?.is_completed).toBe(1);
      expect(todo3?.is_completed).toBe(1);
    });

    it("should skip non-existent todos and report them", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Real todo");
      const fakeId = uuidv4();

      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, fakeId] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(1);
      expect(result.data.skipped).toContain(fakeId);
      expect(result.data.skipped).toHaveLength(1);
    });

    it("should skip already soft-deleted todos", async () => {
      const { body: body1 } = await createTodo(testGroupId, "To be deleted");
      const { body: body2 } = await createTodo(testGroupId, "Active todo");

      await deleteTodo(body1.data.id);

      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, body2.data.id] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(1);
      expect(result.data.skipped).toContain(body1.data.id);
    });

    it("should handle partial success with mixed valid and invalid IDs", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Valid todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Valid todo 2");
      const fakeId1 = uuidv4();
      const fakeId2 = uuidv4();

      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, fakeId1, body2.data.id, fakeId2] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(2);
      expect(result.data.skipped).toHaveLength(2);
      expect(result.data.skipped).toContain(fakeId1);
      expect(result.data.skipped).toContain(fakeId2);
    });

    it("should return 400 if ids is not an array", async () => {
      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: "not-an-array" }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toBeDefined();
    });

    it("should return 400 if ids is an empty array", async () => {
      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toBeDefined();
    });

    it("should return 400 if ids contains non-string values", async () => {
      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [123, "valid-id"] }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toContain("strings");
    });

    it("should return 400 for invalid JSON body", async () => {
      const res = await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toContain("Invalid JSON");
    });

    it("should update updated_at timestamp when completing todos", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Test todo");
      const originalUpdatedAt = body1.data.updated_at;

      // Wait a tiny bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id] }),
      });

      const todo = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      expect(todo?.updated_at).not.toBe(originalUpdatedAt);
    });
  });

  // ─── POST /api/todos/batch/delete ─────────────────────────

  describe("POST /api/todos/batch/delete", () => {
    it("should soft-delete multiple todos and return 200", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Todo 2");
      const { body: body3 } = await createTodo(testGroupId, "Todo 3");

      const res = await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, body2.data.id, body3.data.id] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(3);
      expect(result.data.skipped).toEqual([]);

      // Verify all todos are soft-deleted
      const todo1 = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      const todo2 = ctx.db.select().from(todos).where(eq(todos.id, body2.data.id)).get();
      const todo3 = ctx.db.select().from(todos).where(eq(todos.id, body3.data.id)).get();

      expect(todo1?.deleted_at).not.toBeNull();
      expect(todo2?.deleted_at).not.toBeNull();
      expect(todo3?.deleted_at).not.toBeNull();
    });

    it("should skip non-existent todos and report them", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Real todo");
      const fakeId = uuidv4();

      const res = await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, fakeId] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(1);
      expect(result.data.skipped).toContain(fakeId);
      expect(result.data.skipped).toHaveLength(1);
    });

    it("should skip already soft-deleted todos", async () => {
      const { body: body1 } = await createTodo(testGroupId, "To be deleted");
      const { body: body2 } = await createTodo(testGroupId, "Active todo");

      await deleteTodo(body1.data.id);

      const res = await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, body2.data.id] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(1);
      expect(result.data.skipped).toContain(body1.data.id);
    });

    it("should handle partial success with mixed valid and invalid IDs", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Valid todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Valid todo 2");
      const fakeId1 = uuidv4();
      const fakeId2 = uuidv4();

      const res = await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, fakeId1, body2.data.id, fakeId2] }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(2);
      expect(result.data.skipped).toHaveLength(2);
      expect(result.data.skipped).toContain(fakeId1);
      expect(result.data.skipped).toContain(fakeId2);
    });

    it("should return 400 if ids is not an array", async () => {
      const res = await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: "not-an-array" }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toBeDefined();
    });

    it("should return 400 if ids is an empty array", async () => {
      const res = await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toBeDefined();
    });

    it("should return 400 if ids contains non-string values", async () => {
      const res = await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [123, "valid-id"] }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toContain("strings");
    });

    it("should update updated_at and deleted_at timestamps when deleting todos", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Test todo");
      const originalUpdatedAt = body1.data.updated_at;

      // Wait a tiny bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id] }),
      });

      const todo = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      expect(todo?.updated_at).not.toBe(originalUpdatedAt);
      expect(todo?.deleted_at).not.toBeNull();
    });
  });

  // ─── POST /api/todos/batch/move ─────────────────────────

  describe("POST /api/todos/batch/move", () => {
    it("should move multiple todos to another group and return 200", async () => {
      const { body: existingTarget } = await createTodo(testGroupId2, "Existing target");
      const { body: body1 } = await createTodo(testGroupId, "Todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Todo 2");
      const { body: body3 } = await createTodo(testGroupId, "Todo 3");

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id, body2.data.id, body3.data.id],
          targetGroupId: testGroupId2
        }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(3);
      expect(result.data.skipped).toEqual([]);

      // Verify all todos moved to new group
      const todo1 = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      const todo2 = ctx.db.select().from(todos).where(eq(todos.id, body2.data.id)).get();
      const todo3 = ctx.db.select().from(todos).where(eq(todos.id, body3.data.id)).get();

      expect(todo1?.group_id).toBe(testGroupId2);
      expect(todo2?.group_id).toBe(testGroupId2);
      expect(todo3?.group_id).toBe(testGroupId2);
      expect(existingTarget.data.position).toBe(0);
      expect(todo1?.position).toBe(1);
      expect(todo2?.position).toBe(2);
      expect(todo3?.position).toBe(3);
    });

    it("should skip non-existent todos and report them", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Real todo");
      const fakeId = uuidv4();

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id, fakeId],
          targetGroupId: testGroupId2
        }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(1);
      expect(result.data.skipped).toContain(fakeId);
      expect(result.data.skipped).toHaveLength(1);
    });

    it("should skip soft-deleted todos", async () => {
      const { body: body1 } = await createTodo(testGroupId, "To be deleted");
      const { body: body2 } = await createTodo(testGroupId, "Active todo");

      await deleteTodo(body1.data.id);

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id, body2.data.id],
          targetGroupId: testGroupId2
        }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(1);
      expect(result.data.skipped).toContain(body1.data.id);
    });

    it("should return 404 if target group does not exist", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Test todo");
      const fakeGroupId = uuidv4();

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id],
          targetGroupId: fakeGroupId
        }),
      });

      expect(res.status).toBe(404);
      const result = await res.json();
      expect(result.error).toContain("group not found");
    });

    it("should handle partial success with mixed valid and invalid IDs", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Valid todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Valid todo 2");
      const fakeId1 = uuidv4();
      const fakeId2 = uuidv4();

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id, fakeId1, body2.data.id, fakeId2],
          targetGroupId: testGroupId2
        }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(2);
      expect(result.data.skipped).toHaveLength(2);
      expect(result.data.skipped).toContain(fakeId1);
      expect(result.data.skipped).toContain(fakeId2);
    });

    it("should return 400 if ids is not an array", async () => {
      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: "not-an-array", targetGroupId: testGroupId2 }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toBeDefined();
    });

    it("should return 400 if ids is an empty array", async () => {
      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [], targetGroupId: testGroupId2 }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toBeDefined();
    });

    it("should return 400 if targetGroupId is missing", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Test todo");

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id] }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toContain("targetGroupId");
    });

    it("should return 400 if targetGroupId is not a string", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Test todo");

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id], targetGroupId: 123 }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toContain("targetGroupId");
    });

    it("should return 400 if ids contains non-string values", async () => {
      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [123, "valid-id"], targetGroupId: testGroupId2 }),
      });

      expect(res.status).toBe(400);
      const result = await res.json();
      expect(result.error).toContain("strings");
    });

    it("should update updated_at timestamp when moving todos", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Test todo");
      const originalUpdatedAt = body1.data.updated_at;

      // Wait a tiny bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id],
          targetGroupId: testGroupId2
        }),
      });

      const todo = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      expect(todo?.updated_at).not.toBe(originalUpdatedAt);
    });

    it("should allow moving todos to the same group they are already in", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Test todo");

      const res = await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id],
          targetGroupId: testGroupId  // same group
        }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.data.affected).toBe(1);

      // Verify todo is still in the same group
      const todo = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      expect(todo?.group_id).toBe(testGroupId);
    });
  });

  // ─── Transaction / Atomicity Tests ─────────────────────────

  describe("Transaction guarantees", () => {
    it("should complete all todos in a single transaction", async () => {
      // Create multiple todos
      const { body: body1 } = await createTodo(testGroupId, "Todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Todo 2");
      const { body: body3 } = await createTodo(testGroupId, "Todo 3");

      // Complete all at once
      await ctx.app.request("/api/todos/batch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, body2.data.id, body3.data.id] }),
      });

      // All should have the same updated_at timestamp (within 1 second)
      const todo1 = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      const todo2 = ctx.db.select().from(todos).where(eq(todos.id, body2.data.id)).get();
      const todo3 = ctx.db.select().from(todos).where(eq(todos.id, body3.data.id)).get();

      expect(todo1?.updated_at).toBe(todo2?.updated_at);
      expect(todo2?.updated_at).toBe(todo3?.updated_at);
    });

    it("should soft-delete all todos in a single transaction", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Todo 2");
      const { body: body3 } = await createTodo(testGroupId, "Todo 3");

      await ctx.app.request("/api/todos/batch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [body1.data.id, body2.data.id, body3.data.id] }),
      });

      // All should have the same deleted_at timestamp
      const todo1 = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      const todo2 = ctx.db.select().from(todos).where(eq(todos.id, body2.data.id)).get();
      const todo3 = ctx.db.select().from(todos).where(eq(todos.id, body3.data.id)).get();

      expect(todo1?.deleted_at).toBe(todo2?.deleted_at);
      expect(todo2?.deleted_at).toBe(todo3?.deleted_at);
    });

    it("should move all todos in a single transaction", async () => {
      const { body: body1 } = await createTodo(testGroupId, "Todo 1");
      const { body: body2 } = await createTodo(testGroupId, "Todo 2");
      const { body: body3 } = await createTodo(testGroupId, "Todo 3");

      await ctx.app.request("/api/todos/batch/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [body1.data.id, body2.data.id, body3.data.id],
          targetGroupId: testGroupId2
        }),
      });

      // All should have the same updated_at timestamp
      const todo1 = ctx.db.select().from(todos).where(eq(todos.id, body1.data.id)).get();
      const todo2 = ctx.db.select().from(todos).where(eq(todos.id, body2.data.id)).get();
      const todo3 = ctx.db.select().from(todos).where(eq(todos.id, body3.data.id)).get();

      expect(todo1?.updated_at).toBe(todo2?.updated_at);
      expect(todo2?.updated_at).toBe(todo3?.updated_at);
    });
  });
});
