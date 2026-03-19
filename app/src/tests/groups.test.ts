import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestContext } from "./helpers.js";
import { groups, todos } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("Groups CRUD API", () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeAll(() => {
    ctx = createTestContext();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  beforeEach(() => {
    // Clear tables before each test for isolation
    ctx.db.delete(todos).run();
    ctx.db.delete(groups).run();
  });

  // ─── POST /api/groups ───────────────────────────────────────

  describe("POST /api/groups", () => {
    it("should create a group and return 201", async () => {
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Office" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe("Office");
      expect(body.data.id).toBeDefined();
      expect(body.data.position).toBe(0);
      expect(body.data.created_at).toBeDefined();
      expect(body.data.updated_at).toBeDefined();
    });

    it("should auto-set position to end of list", async () => {
      // Create first group
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "First" }),
      });

      // Create second group
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Second" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.position).toBe(1);
    });

    it("should return 400 if name is missing", async () => {
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("should return 400 if name is empty string", async () => {
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("should return 400 if name is only whitespace", async () => {
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("should return 400 if name exceeds 100 characters", async () => {
      const longName = "a".repeat(101);
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: longName }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("100");
    });

    it("should return 400 if name already exists", async () => {
      // Create first group
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Duplicate" }),
      });

      // Try to create duplicate
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Duplicate" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("already exists");
    });

    it("should trim name whitespace", async () => {
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  Office  " }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.name).toBe("Office");
    });

    it("should auto-capitalize first letter on create", async () => {
      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "home list" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.name).toBe("Home list");
    });

    it("should return 400 for case-insensitive duplicate group names", async () => {
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Office" }),
      });

      const res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "office" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("already exists");
    });
  });

  // ─── GET /api/groups ────────────────────────────────────────

  describe("GET /api/groups", () => {
    it("should return empty array when no groups exist", async () => {
      const res = await ctx.app.request("/api/groups");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });

    it("should return all groups sorted by position", async () => {
      // Create groups
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alpha" }),
      });
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Beta" }),
      });
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Gamma" }),
      });

      const res = await ctx.app.request("/api/groups");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(3);
      expect(body.data[0].name).toBe("Alpha");
      expect(body.data[1].name).toBe("Beta");
      expect(body.data[2].name).toBe("Gamma");
      expect(body.data[0].position).toBe(0);
      expect(body.data[1].position).toBe(1);
      expect(body.data[2].position).toBe(2);
    });
  });

  // ─── GET /api/groups/:id ────────────────────────────────────

  describe("GET /api/groups/:id", () => {
    it("should return a single group by id", async () => {
      // Create a group
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Office" }),
      });
      const created = await createRes.json();
      const groupId = created.data.id;

      // Fetch it
      const res = await ctx.app.request(`/api/groups/${groupId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(groupId);
      expect(body.data.name).toBe("Office");
    });

    it("should return 404 for non-existent group", async () => {
      const res = await ctx.app.request(`/api/groups/${uuidv4()}`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });
  });

  // ─── PATCH /api/groups/:id ──────────────────────────────────

  describe("PATCH /api/groups/:id", () => {
    it("should update group name", async () => {
      // Create
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Old Name" }),
      });
      const created = await createRes.json();
      const groupId = created.data.id;

      // Small delay to ensure updated_at differs
      await new Promise((r) => setTimeout(r, 10));

      // Update
      const res = await ctx.app.request(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("New Name");
      expect(body.data.id).toBe(groupId);
      expect(body.data.updated_at).not.toBe(created.data.updated_at);
    });

    it("should return 404 for non-existent group", async () => {
      const res = await ctx.app.request(`/api/groups/${uuidv4()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should return 400 for empty name", async () => {
      // Create
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });
      const created = await createRes.json();

      const res = await ctx.app.request(`/api/groups/${created.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 if name exceeds 100 characters", async () => {
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });
      const created = await createRes.json();

      const res = await ctx.app.request(`/api/groups/${created.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "a".repeat(101) }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 if new name conflicts with another group", async () => {
      // Create two groups
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Group A" }),
      });
      const createRes2 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Group B" }),
      });
      const groupB = await createRes2.json();

      // Try to rename Group B to Group A
      const res = await ctx.app.request(`/api/groups/${groupB.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Group A" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("already exists");
    });

    it("should allow renaming a group to its own name", async () => {
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Same Name" }),
      });
      const created = await createRes.json();

      const res = await ctx.app.request(`/api/groups/${created.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Same Name" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("Same Name");
    });

    it("should auto-capitalize first letter on update", async () => {
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Initial" }),
      });
      const created = await createRes.json();

      const res = await ctx.app.request(`/api/groups/${created.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "work tasks" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("Work tasks");
    });

    it("should block case-insensitive duplicates on update", async () => {
      await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Personal" }),
      });
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Work" }),
      });
      const work = await createRes.json();

      const res = await ctx.app.request(`/api/groups/${work.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "personal" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("already exists");
    });
  });

  // ─── DELETE /api/groups/:id ─────────────────────────────────

  describe("DELETE /api/groups/:id", () => {
    it("should delete a group and return 200", async () => {
      // Create
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "To Delete" }),
      });
      const created = await createRes.json();

      // Delete
      const res = await ctx.app.request(`/api/groups/${created.data.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.message).toContain("deleted");

      // Verify it's gone
      const getRes = await ctx.app.request(`/api/groups/${created.data.id}`);
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent group", async () => {
      const res = await ctx.app.request(`/api/groups/${uuidv4()}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("should move all group todos to trash when deleting a group", async () => {
      // Create a group
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Has Todos" }),
      });
      const group = await createRes.json();
      const groupId = group.data.id;

      // Insert some todos directly via DB for this group
      const now = new Date().toISOString();
      const todoId1 = uuidv4();
      const todoId2 = uuidv4();
      ctx.db.insert(todos).values([
        { id: todoId1, group_id: groupId, title: "Todo 1", is_completed: 0, position: 0, created_at: now, updated_at: now },
        { id: todoId2, group_id: groupId, title: "Todo 2", is_completed: 0, position: 1, created_at: now, updated_at: now },
      ]).run();

      // Verify todos exist
      const todosBefore = ctx.db.select().from(todos).where(eq(todos.group_id, groupId)).all();
      expect(todosBefore).toHaveLength(2);

      // Delete the group
      const res = await ctx.app.request(`/api/groups/${groupId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      // Verify todos are moved to trash, not hard-deleted
      const todosAfter = ctx.db.select().from(todos).where(eq(todos.group_id, groupId)).all();
      expect(todosAfter).toHaveLength(2);
      expect(todosAfter.every((t) => t.deleted_at !== null)).toBe(true);

      const trashRes = await ctx.app.request("/api/trash");
      const trashBody = await trashRes.json();
      expect(trashRes.status).toBe(200);
      expect(trashBody.data.todos).toHaveLength(2);
      expect(trashBody.data.todos.every((t: any) => t.group_name === "Has Todos")).toBe(true);
    });
  });

  // ─── PATCH /api/groups/reorder ──────────────────────────────

  describe("PATCH /api/groups/reorder", () => {
    it("should reorder groups", async () => {
      // Create three groups
      const res1 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "First" }),
      });
      const res2 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Second" }),
      });
      const res3 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Third" }),
      });

      const g1 = await res1.json();
      const g2 = await res2.json();
      const g3 = await res3.json();

      // Reorder: Third → 0, First → 1, Second → 2
      const reorderRes = await ctx.app.request("/api/groups/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: g3.data.id, position: 0 },
            { id: g1.data.id, position: 1 },
            { id: g2.data.id, position: 2 },
          ],
        }),
      });

      expect(reorderRes.status).toBe(200);
      const body = await reorderRes.json();
      expect(body.data).toHaveLength(3);
      expect(body.data[0].name).toBe("Third");
      expect(body.data[0].position).toBe(0);
      expect(body.data[1].name).toBe("First");
      expect(body.data[1].position).toBe(1);
      expect(body.data[2].name).toBe("Second");
      expect(body.data[2].position).toBe(2);
    });

    it("should return 400 if items is not an array", async () => {
      const res = await ctx.app.request("/api/groups/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: "not-an-array" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 if items is empty", async () => {
      const res = await ctx.app.request("/api/groups/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 if items have invalid shape", async () => {
      const res = await ctx.app.request("/api/groups/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ id: "some-id" }], // missing position
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for duplicate group ids", async () => {
      const res1 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "First" }),
      });
      const res2 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Second" }),
      });
      const g1 = await res1.json();
      const g2 = await res2.json();

      const reorderRes = await ctx.app.request("/api/groups/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: g1.data.id, position: 0 },
            { id: g1.data.id, position: 1 },
            { id: g2.data.id, position: 2 },
          ],
        }),
      });

      expect(reorderRes.status).toBe(400);
    });

    it("should return 400 when payload does not include every active group", async () => {
      const res1 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "First" }),
      });
      const res2 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Second" }),
      });
      const g1 = await res1.json();
      await res2.json();

      const reorderRes = await ctx.app.request("/api/groups/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ id: g1.data.id, position: 0 }],
        }),
      });

      expect(reorderRes.status).toBe(400);
    });
  });

  // ─── Response shape tests ──────────────────────────────────

  describe("Response shape", () => {
    it("all success responses should follow { data: ... } shape", async () => {
      // Create
      const createRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Shape Test" }),
      });
      const created = await createRes.json();
      expect(created).toHaveProperty("data");

      // List
      const listRes = await ctx.app.request("/api/groups");
      const listed = await listRes.json();
      expect(listed).toHaveProperty("data");

      // Get single
      const getRes = await ctx.app.request(`/api/groups/${created.data.id}`);
      const got = await getRes.json();
      expect(got).toHaveProperty("data");
    });

    it("error responses should follow { error: string } shape", async () => {
      // 404
      const res404 = await ctx.app.request(`/api/groups/${uuidv4()}`);
      const body404 = await res404.json();
      expect(body404).toHaveProperty("error");
      expect(typeof body404.error).toBe("string");

      // 400 validation error
      const res400 = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });
      const body400 = await res400.json();
      expect(body400).toHaveProperty("error");
      expect(typeof body400.error).toBe("string");
    });
  });
});
