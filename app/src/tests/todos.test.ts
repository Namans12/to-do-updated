import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestContext } from "./helpers.js";
import { groups, todos, connections, connectionItems } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("Todos CRUD API", () => {
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

    // Create a default test group for todos
    const res = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Group" }),
    });
    const body = await res.json();
    testGroupId = body.data.id;
  });

  // Helper to create a todo via API
  async function createTodo(
    groupId: string,
    title: string,
    description?: string,
    options?: { high_priority?: boolean; reminder_at?: string | null }
  ) {
    const payload: any = { title };
    if (description !== undefined) payload.description = description;
    if (options?.high_priority !== undefined) payload.high_priority = options.high_priority;
    if (options?.reminder_at !== undefined) payload.reminder_at = options.reminder_at;

    const res = await ctx.app.request(`/api/groups/${groupId}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, body: await res.json() };
  }

  async function createConnection(
    todoIds: string[],
    kind: "sequence" | "dependency" | "branch" | "related" = "sequence"
  ) {
    const res = await ctx.app.request("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todoIds, kind }),
    });
    return { res, body: await res.json() };
  }

  // ─── POST /api/groups/:groupId/todos ─────────────────────────

  describe("POST /api/groups/:groupId/todos", () => {
    it("should create a todo and return 201", async () => {
      const { res, body } = await createTodo(testGroupId, "buy groceries");

      expect(res.status).toBe(201);
      expect(body.data).toBeDefined();
      expect(body.data.title).toBe("Buy groceries"); // auto-capitalized
      expect(body.data.group_id).toBe(testGroupId);
      expect(body.data.is_completed).toBe(0);
      expect(body.data.completed_at).toBeNull();
      expect(body.data.position).toBe(0);
      expect(body.data.deleted_at).toBeNull();
      expect(body.data.id).toBeDefined();
      expect(body.data.created_at).toBeDefined();
      expect(body.data.updated_at).toBeDefined();
    });

    it("should auto-capitalize the first letter of the title", async () => {
      const { body } = await createTodo(testGroupId, "walk the dog");
      expect(body.data.title).toBe("Walk the dog");
    });

    it("should auto-capitalize even a single character title", async () => {
      const { body } = await createTodo(testGroupId, "a");
      expect(body.data.title).toBe("A");
    });

    it("should preserve already capitalized titles", async () => {
      const { body } = await createTodo(testGroupId, "Already Capitalized");
      expect(body.data.title).toBe("Already Capitalized");
    });

    it("should create a todo with a description", async () => {
      const { body } = await createTodo(
        testGroupId,
        "Write report",
        "Quarterly earnings report for Q4"
      );

      expect(body.data.title).toBe("Write report");
      expect(body.data.description).toBe("Quarterly earnings report for Q4");
    });

    it("should create a todo with null description when not provided", async () => {
      const { body } = await createTodo(testGroupId, "No description");
      expect(body.data.description).toBeNull();
    });

    it("should create a high-priority todo with reminder", async () => {
      const reminderAt = new Date(Date.now() + 60_000).toISOString();
      const { body } = await createTodo(testGroupId, "Important", undefined, {
        high_priority: true,
        reminder_at: reminderAt,
      });

      expect(body.data.high_priority).toBe(1);
      expect(body.data.reminder_at).toBeDefined();
    });

    it("should create a recurring reminder task with planning metadata", async () => {
      const reminderAt = new Date(Date.now() + 60_000).toISOString();
      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Recurring",
          reminder_at: reminderAt,
          recurrence_rule: "daily",
          planning_level: 2,
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.recurrence_rule).toBe("daily");
      expect(body.data.recurrence_enabled).toBe(1);
      expect(body.data.next_occurrence_at).toBe(body.data.reminder_at);
      expect(body.data.planning_level).toBe(2);
    });

    it("should allow recurring tasks without a reminder timestamp", async () => {
      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Weekly review",
          recurrence_rule: "weekly",
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.recurrence_rule).toBe("weekly");
      expect(body.data.recurrence_enabled).toBe(1);
      expect(body.data.reminder_at).toBeNull();
      expect(body.data.next_occurrence_at).toBeTruthy();
    });

    it("should auto-set position to end of group list", async () => {
      const { body: body1 } = await createTodo(testGroupId, "First");
      const { body: body2 } = await createTodo(testGroupId, "Second");
      const { body: body3 } = await createTodo(testGroupId, "Third");

      expect(body1.data.position).toBe(0);
      expect(body2.data.position).toBe(1);
      expect(body3.data.position).toBe(2);
    });

    it("should return 404 if group does not exist", async () => {
      const fakeGroupId = uuidv4();
      const { res, body } = await createTodo(fakeGroupId, "Orphan todo");

      expect(res.status).toBe(404);
      expect(body.error).toContain("not found");
    });

    it("should return 400 if title is missing", async () => {
      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("should return 400 if title is empty string", async () => {
      const { res, body } = await createTodo(testGroupId, "");

      expect(res.status).toBe(400);
      expect(body.error).toBeDefined();
    });

    it("should return 400 if title is only whitespace", async () => {
      const { res, body } = await createTodo(testGroupId, "   ");

      expect(res.status).toBe(400);
      expect(body.error).toBeDefined();
    });

    it("should return 400 if title exceeds 500 characters", async () => {
      const longTitle = "a".repeat(501);
      const { res, body } = await createTodo(testGroupId, longTitle);

      expect(res.status).toBe(400);
      expect(body.error).toContain("500");
    });

    it("should return 400 for invalid reminder_at", async () => {
      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Bad reminder", reminder_at: "not-a-date" }),
      });
      expect(res.status).toBe(400);
    });

    it("should return 400 for reminder_at in the past on create", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Past reminder", reminder_at: past }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/groups/:groupId/todos ──────────────────────────

  describe("GET /api/groups/:groupId/todos", () => {
    it("should return empty array when no todos exist", async () => {
      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });

    it("should return todos sorted by position", async () => {
      await createTodo(testGroupId, "First");
      await createTodo(testGroupId, "Second");
      await createTodo(testGroupId, "Third");

      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(3);
      expect(body.data[0].title).toBe("First");
      expect(body.data[1].title).toBe("Second");
      expect(body.data[2].title).toBe("Third");
    });

    it("should exclude soft-deleted todos by default", async () => {
      const { body: created } = await createTodo(testGroupId, "To be deleted");
      await createTodo(testGroupId, "Keep me");

      // Soft-delete the first todo
      await ctx.app.request(`/api/todos/${created.data.id}`, {
        method: "DELETE",
      });

      const res = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe("Keep me");
    });

    it("should include soft-deleted todos when include_deleted=true", async () => {
      const { body: created } = await createTodo(testGroupId, "To be deleted");
      await createTodo(testGroupId, "Keep me");

      // Soft-delete the first todo
      await ctx.app.request(`/api/todos/${created.data.id}`, {
        method: "DELETE",
      });

      const res = await ctx.app.request(
        `/api/groups/${testGroupId}/todos?include_deleted=true`
      );
      const body = await res.json();
      expect(body.data).toHaveLength(2);
    });

    it("should return 404 if group does not exist", async () => {
      const fakeGroupId = uuidv4();
      const res = await ctx.app.request(`/api/groups/${fakeGroupId}/todos`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should only return todos from the specified group", async () => {
      // Create a second group
      const groupRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Other Group" }),
      });
      const otherGroup = await groupRes.json();
      const otherGroupId = otherGroup.data.id;

      await createTodo(testGroupId, "Group 1 todo");
      await createTodo(otherGroupId, "Group 2 todo");

      const res1 = await ctx.app.request(
        `/api/groups/${testGroupId}/todos`
      );
      const body1 = await res1.json();
      expect(body1.data).toHaveLength(1);
      expect(body1.data[0].title).toBe("Group 1 todo");

      const res2 = await ctx.app.request(
        `/api/groups/${otherGroupId}/todos`
      );
      const body2 = await res2.json();
      expect(body2.data).toHaveLength(1);
      expect(body2.data[0].title).toBe("Group 2 todo");
    });
  });

  // ─── GET /api/todos/:id ──────────────────────────────────────

  describe("GET /api/todos/:id", () => {
    it("should return a single todo by id", async () => {
      const { body: created } = await createTodo(
        testGroupId,
        "fetch me",
        "Some description"
      );
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(todoId);
      expect(body.data.title).toBe("Fetch me");
      expect(body.data.description).toBe("Some description");
      expect(body.data.group_id).toBe(testGroupId);
    });

    it("should return 404 for non-existent todo", async () => {
      const res = await ctx.app.request(`/api/todos/${uuidv4()}`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should still return a soft-deleted todo by direct ID lookup", async () => {
      const { body: created } = await createTodo(testGroupId, "deleted item");

      // Soft-delete it
      await ctx.app.request(`/api/todos/${created.data.id}`, {
        method: "DELETE",
      });

      // Direct ID lookup should still return it
      const res = await ctx.app.request(`/api/todos/${created.data.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.deleted_at).not.toBeNull();
    });
  });

  // ─── PATCH /api/todos/:id ────────────────────────────────────

  describe("PATCH /api/todos/:id", () => {
    it("should update the title", async () => {
      const { body: created } = await createTodo(testGroupId, "old title");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "new title" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe("New title"); // auto-capitalized
    });

    it("should update the description", async () => {
      const { body: created } = await createTodo(testGroupId, "has desc");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "A new description" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.description).toBe("A new description");
    });

    it("should allow clearing description to null", async () => {
      const { body: created } = await createTodo(
        testGroupId,
        "has desc",
        "Original description"
      );
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: null }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.description).toBeNull();
    });

    it("should update both title and description at once", async () => {
      const { body: created } = await createTodo(testGroupId, "original");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "updated title",
          description: "updated description",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe("Updated title");
      expect(body.data.description).toBe("updated description");
    });

    it("should update high_priority and reminder_at", async () => {
      const { body: created } = await createTodo(testGroupId, "remind me");
      const todoId = created.data.id;
      const reminderAt = new Date(Date.now() + 120_000).toISOString();

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ high_priority: true, reminder_at: reminderAt }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.high_priority).toBe(1);
      expect(body.data.reminder_at).toBeDefined();
    });

    it("should update recurrence and parent task", async () => {
      const { body: parent } = await createTodo(testGroupId, "parent");
      const { body: child } = await createTodo(testGroupId, "child");
      const reminderAt = new Date(Date.now() + 120_000).toISOString();

      const res = await ctx.app.request(`/api/todos/${child.data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reminder_at: reminderAt,
          recurrence_rule: "weekly",
          planning_level: 3,
          parent_todo_id: parent.data.id,
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.recurrence_rule).toBe("weekly");
      expect(body.data.recurrence_enabled).toBe(1);
      expect(body.data.parent_todo_id).toBe(parent.data.id);
      expect(body.data.planning_level).toBe(3);
    });

    it("should update updated_at timestamp", async () => {
      const { body: created } = await createTodo(testGroupId, "timestamped");
      const todoId = created.data.id;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "updated" }),
      });

      const body = await res.json();
      expect(body.data.updated_at).not.toBe(created.data.updated_at);
    });

    it("should auto-capitalize the title on update", async () => {
      const { body: created } = await createTodo(testGroupId, "original");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "lowercase start" }),
      });

      const body = await res.json();
      expect(body.data.title).toBe("Lowercase start");
    });

    it("should return 404 for non-existent todo", async () => {
      const res = await ctx.app.request(`/api/todos/${uuidv4()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "No such todo" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should return 400 for empty title", async () => {
      const { body: created } = await createTodo(testGroupId, "valid");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for title exceeding 500 characters", async () => {
      const { body: created } = await createTodo(testGroupId, "valid");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "a".repeat(501) }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("500");
    });

    it("should return 400 for invalid high_priority type", async () => {
      const { body: created } = await createTodo(testGroupId, "valid");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ high_priority: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    it("should return 400 for reminder_at in the past on update", async () => {
      const { body: created } = await createTodo(testGroupId, "valid");
      const todoId = created.data.id;
      const past = new Date(Date.now() - 60_000).toISOString();

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminder_at: past }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /api/todos/:id/complete ────────────────────────────

  describe("PATCH /api/todos/:id/complete", () => {
    it("should toggle completion from 0 to 1", async () => {
      const { body: created } = await createTodo(testGroupId, "complete me");
      const todoId = created.data.id;
      expect(created.data.is_completed).toBe(0);

      const res = await ctx.app.request(`/api/todos/${todoId}/complete`, {
        method: "PATCH",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.is_completed).toBe(1);
      expect(body.data.completed_at).toBeTruthy();
    });

    it("should toggle completion from 1 back to 0", async () => {
      const { body: created } = await createTodo(testGroupId, "toggle me");
      const todoId = created.data.id;

      // Complete it
      await ctx.app.request(`/api/todos/${todoId}/complete`, {
        method: "PATCH",
      });

      // Un-complete it
      const res = await ctx.app.request(`/api/todos/${todoId}/complete`, {
        method: "PATCH",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.is_completed).toBe(0);
      expect(body.data.completed_at).toBeNull();
    });

    it("should update updated_at on completion toggle", async () => {
      const { body: created } = await createTodo(testGroupId, "timestamped");
      const todoId = created.data.id;

      await new Promise((r) => setTimeout(r, 10));

      const res = await ctx.app.request(`/api/todos/${todoId}/complete`, {
        method: "PATCH",
      });

      const body = await res.json();
      expect(body.data.updated_at).not.toBe(created.data.updated_at);
    });

    it("should return 404 for non-existent todo", async () => {
      const res = await ctx.app.request(`/api/todos/${uuidv4()}/complete`, {
        method: "PATCH",
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should block completion when a dependency predecessor is incomplete", async () => {
      const { body: first } = await createTodo(testGroupId, "first dependency");
      const { body: second } = await createTodo(testGroupId, "second dependency");

      const connectionRes = await createConnection(
        [first.data.id, second.data.id],
        "dependency"
      );
      expect(connectionRes.res.status).toBe(201);

      const res = await ctx.app.request(`/api/todos/${second.data.id}/complete`, {
        method: "PATCH",
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("Complete");
      expect(body.error).toContain("First dependency");
    });

    it("should allow dependency completion once prior steps are complete", async () => {
      const { body: first } = await createTodo(testGroupId, "unlock me");
      const { body: second } = await createTodo(testGroupId, "now me");

      const connectionRes = await createConnection(
        [first.data.id, second.data.id],
        "dependency"
      );
      expect(connectionRes.res.status).toBe(201);

      const firstRes = await ctx.app.request(`/api/todos/${first.data.id}/complete`, {
        method: "PATCH",
      });
      expect(firstRes.status).toBe(200);

      const secondRes = await ctx.app.request(`/api/todos/${second.data.id}/complete`, {
        method: "PATCH",
      });
      const secondBody = await secondRes.json();

      expect(secondRes.status).toBe(200);
      expect(secondBody.data.is_completed).toBe(1);
    });

    it("should create the next recurring task instance when a recurring task is completed", async () => {
      const createRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Weekly review",
          recurrence_rule: "weekly",
        }),
      });
      const created = await createRes.json();

      const completeRes = await ctx.app.request(`/api/todos/${created.data.id}/complete`, {
        method: "PATCH",
      });
      expect(completeRes.status).toBe(200);

      const listRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      const listBody = await listRes.json();
      expect(listBody.data).toHaveLength(2);
      const reopened = listBody.data.find((todo: any) => todo.id !== created.data.id);
      expect(reopened.title).toBe("Weekly review");
      expect(reopened.is_completed).toBe(0);
      expect(reopened.recurrence_rule).toBe("weekly");
      expect(reopened.next_occurrence_at).toBeTruthy();
    });
  });

  describe("POST /api/todos/:id/reminder/ack", () => {
    it("should advance a recurring reminder to the next occurrence", async () => {
      const reminderAt = new Date(Date.now() + 60_000).toISOString();
      const createRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Recurring",
          reminder_at: reminderAt,
          recurrence_rule: "daily",
        }),
      });
      const created = await createRes.json();

      const res = await ctx.app.request(`/api/todos/${created.data.id}/reminder/ack`, {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.reminder_at).not.toBe(reminderAt);
      expect(body.data.recurrence_enabled).toBe(1);
      expect(new Date(body.data.reminder_at).getTime()).toBeGreaterThan(new Date(reminderAt).getTime());
    });
  });

  // ─── DELETE /api/todos/:id ───────────────────────────────────

  describe("DELETE /api/todos/:id", () => {
    it("should soft-delete a todo (set deleted_at)", async () => {
      const { body: created } = await createTodo(testGroupId, "delete me");
      const todoId = created.data.id;

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.deleted_at).not.toBeNull();
      expect(body.data.id).toBe(todoId);
    });

    it("should set updated_at when soft-deleting", async () => {
      const { body: created } = await createTodo(testGroupId, "timestamped");
      const todoId = created.data.id;

      await new Promise((r) => setTimeout(r, 10));

      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "DELETE",
      });

      const body = await res.json();
      expect(body.data.updated_at).not.toBe(created.data.updated_at);
    });

    it("should return 404 for non-existent todo", async () => {
      const res = await ctx.app.request(`/api/todos/${uuidv4()}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("should return 400 if todo is already soft-deleted", async () => {
      const { body: created } = await createTodo(testGroupId, "already deleted");
      const todoId = created.data.id;

      // Soft-delete once
      await ctx.app.request(`/api/todos/${todoId}`, { method: "DELETE" });

      // Try to soft-delete again
      const res = await ctx.app.request(`/api/todos/${todoId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("already deleted");
    });

    it("should NOT hard-delete the todo (soft-delete only)", async () => {
      const { body: created } = await createTodo(testGroupId, "soft only");
      const todoId = created.data.id;

      await ctx.app.request(`/api/todos/${todoId}`, { method: "DELETE" });

      // Verify the row still exists in DB
      const row = ctx.db
        .select()
        .from(todos)
        .where(eq(todos.id, todoId))
        .get();

      expect(row).toBeDefined();
      expect(row!.deleted_at).not.toBeNull();
    });
  });

  // ─── PATCH /api/todos/reorder ────────────────────────────────

  describe("PATCH /api/todos/reorder", () => {
    it("should reorder todos within a group", async () => {
      const { body: b1 } = await createTodo(testGroupId, "First");
      const { body: b2 } = await createTodo(testGroupId, "Second");
      const { body: b3 } = await createTodo(testGroupId, "Third");

      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: b3.data.id, position: 0 },
            { id: b1.data.id, position: 1 },
            { id: b2.data.id, position: 2 },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.message).toContain("reordered");

      // Verify the order via list endpoint
      const listRes = await ctx.app.request(
        `/api/groups/${testGroupId}/todos`
      );
      const listBody = await listRes.json();
      expect(listBody.data[0].title).toBe("Third");
      expect(listBody.data[0].position).toBe(0);
      expect(listBody.data[1].title).toBe("First");
      expect(listBody.data[1].position).toBe(1);
      expect(listBody.data[2].title).toBe("Second");
      expect(listBody.data[2].position).toBe(2);
    });

    it("should return 400 if items is not an array", async () => {
      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: "not-an-array" }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 if items is empty", async () => {
      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 if items have invalid shape", async () => {
      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ id: "some-id" }], // missing position
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for duplicate todo ids", async () => {
      const { body: b1 } = await createTodo(testGroupId, "First");
      const { body: b2 } = await createTodo(testGroupId, "Second");

      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: b1.data.id, position: 0 },
            { id: b1.data.id, position: 1 },
            { id: b2.data.id, position: 2 },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 when todos span multiple groups", async () => {
      const groupRes = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Other Group" }),
      });
      const otherGroup = await groupRes.json();
      const { body: b1 } = await createTodo(testGroupId, "First");
      const { body: b2 } = await createTodo(otherGroup.data.id, "Second");

      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: b1.data.id, position: 0 },
            { id: b2.data.id, position: 1 },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 when high priority todos are moved below normal todos", async () => {
      const { body: high } = await createTodo(testGroupId, "Urgent", undefined, {
        high_priority: true,
      });
      const { body: normal } = await createTodo(testGroupId, "Normal");

      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: normal.data.id, position: 0 },
            { id: high.data.id, position: 1 },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should allow reordering only the incomplete todos while completed todos stay separate", async () => {
      const { body: first } = await createTodo(testGroupId, "First");
      const { body: second } = await createTodo(testGroupId, "Second");
      const { body: done } = await createTodo(testGroupId, "Done");

      await ctx.app.request(`/api/todos/${done.data.id}/complete`, {
        method: "PATCH",
      });

      const res = await ctx.app.request("/api/todos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            { id: second.data.id, position: 0 },
            { id: first.data.id, position: 1 },
          ],
        }),
      });

      expect(res.status).toBe(200);

      const listRes = await ctx.app.request(`/api/groups/${testGroupId}/todos`);
      const listBody = await listRes.json();
      expect(listBody.data.map((todo: any) => todo.title)).toEqual(["Second", "First", "Done"]);
    });
  });

  // ─── Response shape tests ────────────────────────────────────

  describe("Response shape", () => {
    it("all success responses should follow { data: ... } shape", async () => {
      // Create
      const { body: createBody } = await createTodo(testGroupId, "shape test");
      expect(createBody).toHaveProperty("data");

      // List
      const listRes = await ctx.app.request(
        `/api/groups/${testGroupId}/todos`
      );
      const listBody = await listRes.json();
      expect(listBody).toHaveProperty("data");

      // Get single
      const getRes = await ctx.app.request(
        `/api/todos/${createBody.data.id}`
      );
      const getBody = await getRes.json();
      expect(getBody).toHaveProperty("data");

      // Update
      const updateRes = await ctx.app.request(
        `/api/todos/${createBody.data.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "updated shape" }),
        }
      );
      const updateBody = await updateRes.json();
      expect(updateBody).toHaveProperty("data");

      // Complete
      const completeRes = await ctx.app.request(
        `/api/todos/${createBody.data.id}/complete`,
        { method: "PATCH" }
      );
      const completeBody = await completeRes.json();
      expect(completeBody).toHaveProperty("data");

      // Delete
      const deleteRes = await ctx.app.request(
        `/api/todos/${createBody.data.id}`,
        { method: "DELETE" }
      );
      const deleteBody = await deleteRes.json();
      expect(deleteBody).toHaveProperty("data");
    });

    it("error responses should follow { error: string } shape", async () => {
      // 404
      const res404 = await ctx.app.request(`/api/todos/${uuidv4()}`);
      const body404 = await res404.json();
      expect(body404).toHaveProperty("error");
      expect(typeof body404.error).toBe("string");

      // 400 validation error
      const res400 = await ctx.app.request(
        `/api/groups/${testGroupId}/todos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "" }),
        }
      );
      const body400 = await res400.json();
      expect(body400).toHaveProperty("error");
      expect(typeof body400.error).toBe("string");
    });
  });
});
