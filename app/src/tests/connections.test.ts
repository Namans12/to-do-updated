import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestContext } from "./helpers.js";
import { groups, todos, connections, connectionItems } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

describe("Node Connections API", () => {
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
  async function createTodo(groupId: string, title: string, options?: { high_priority?: boolean }) {
    const res = await ctx.app.request(`/api/groups/${groupId}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        high_priority: options?.high_priority,
      }),
    });
    return (await res.json()).data;
  }

  // Helper: complete a todo via API
  async function completeTodo(todoId: string) {
    const res = await ctx.app.request(`/api/todos/${todoId}/complete`, {
      method: "PATCH",
    });
    return (await res.json()).data;
  }

  // Helper: create a connection via API
  async function createConnection(
    todoIds: string[],
    name?: string,
    kind?: "sequence" | "dependency" | "branch" | "related"
  ) {
    const body: any = { todoIds };
    if (name !== undefined) body.name = name;
    if (kind !== undefined) body.kind = kind;
    const res = await ctx.app.request("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, body: await res.json() };
  }

  async function addConnectionItem(connectionId: string, todoId: string, parentTodoId?: string) {
    const res = await ctx.app.request(`/api/connections/${connectionId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parentTodoId ? { todoId, parentTodoId } : { todoId }),
    });
    return { res, body: await res.json() };
  }

  // ─── POST /api/connections ─────────────────────────

  describe("POST /api/connections", () => {
    it("should create a connection with 2 todos", async () => {
      const todo1 = await createTodo(testGroupId, "buy groceries");
      const todo2 = await createTodo(testGroupId, "cook dinner");

      const { res, body } = await createConnection(
        [todo1.id, todo2.id],
        "Grocery Run"
      );

      expect(res.status).toBe(201);
      expect(body.data.id).toBeTruthy();
      expect(body.data.name).toBe("Grocery Run");
      expect(body.data.kind).toBe("sequence");
      expect(body.data.items).toHaveLength(2);
      expect(body.data.items[0].todo_id).toBe(todo1.id);
      expect(body.data.items[0].title).toBe("Buy groceries");
      expect(body.data.items[0].position).toBe(0);
      expect(body.data.items[0].high_priority).toBe(0);
      expect(body.data.items[0].completed_at).toBeNull();
      expect(body.data.items[0].created_at).toBeTruthy();
      expect(body.data.items[1].todo_id).toBe(todo2.id);
      expect(body.data.items[1].position).toBe(1);
      expect(body.data.progress).toMatchObject({
        total: 2,
        completed: 0,
        percentage: 0,
        blocked_count: 0,
        available_count: 2,
        next_available_item_id: todo1.id,
      });
      expect(body.data.is_fully_complete).toBe(false);
      expect(body.data.created_at).toBeTruthy();
    });

    it("should create a connection without a name", async () => {
      const todo1 = await createTodo(testGroupId, "task a");
      const todo2 = await createTodo(testGroupId, "task b");

      const { res, body } = await createConnection([todo1.id, todo2.id]);

      expect(res.status).toBe(201);
      expect(body.data.name).toBeNull();
      expect(body.data.kind).toBe("sequence");
      expect(body.data.items).toHaveLength(2);
    });

    it("should create a connection with an explicit kind", async () => {
      const todo1 = await createTodo(testGroupId, "task a");
      const todo2 = await createTodo(testGroupId, "task b");

      const { res, body } = await createConnection([todo1.id, todo2.id], "Blocked", "dependency");

      expect(res.status).toBe(201);
      expect(body.data.kind).toBe("dependency");
    });

    it("should create a connection with more than 2 todos", async () => {
      const todo1 = await createTodo(testGroupId, "step 1");
      const todo2 = await createTodo(testGroupId, "step 2");
      const todo3 = await createTodo(testGroupId, "step 3");

      const { res, body } = await createConnection(
        [todo1.id, todo2.id, todo3.id],
        "Multi-step"
      );

      expect(res.status).toBe(201);
      expect(body.data.items).toHaveLength(3);
      expect(body.data.progress.total).toBe(3);
    });

    it("should include high_priority on connection items", async () => {
      const urgent = await createTodo(testGroupId, "urgent", { high_priority: true });
      const normal = await createTodo(testGroupId, "normal");

      const { res, body } = await createConnection([urgent.id, normal.id], "Urgency Check");

      expect(res.status).toBe(201);
      expect(body.data.items[0].high_priority).toBe(1);
      expect(body.data.items[1].high_priority).toBe(0);
    });

    it("should return 400 if fewer than 2 todoIds are provided", async () => {
      const todo1 = await createTodo(testGroupId, "lonely todo");

      const { res, body } = await createConnection([todo1.id]);

      expect(res.status).toBe(400);
      expect(body.error).toContain("at least 2");
    });

    it("should return 400 if todoIds is empty", async () => {
      const { res, body } = await createConnection([]);

      expect(res.status).toBe(400);
      expect(body.error).toContain("at least 2");
    });

    it("should return 400 if todoIds is not an array", async () => {
      const res = await ctx.app.request("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoIds: "not-an-array" }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("at least 2");
    });

    it("should return 404 if a todo does not exist", async () => {
      const todo1 = await createTodo(testGroupId, "real todo");
      const fakeId = uuidv4();

      const { res, body } = await createConnection([todo1.id, fakeId]);

      expect(res.status).toBe(404);
      expect(body.error).toContain(fakeId);
    });

    it("should return 404 if a todo is soft-deleted", async () => {
      const todo1 = await createTodo(testGroupId, "active");
      const todo2 = await createTodo(testGroupId, "deleted");

      // Soft-delete todo2
      await ctx.app.request(`/api/todos/${todo2.id}`, { method: "DELETE" });

      const { res, body } = await createConnection([todo1.id, todo2.id]);

      expect(res.status).toBe(404);
      expect(body.error).toContain(todo2.id);
    });

    it("should return 400 if a todo already belongs to a connection", async () => {
      const todo1 = await createTodo(testGroupId, "connected 1");
      const todo2 = await createTodo(testGroupId, "connected 2");
      const todo3 = await createTodo(testGroupId, "new todo");

      // Create first connection
      await createConnection([todo1.id, todo2.id], "First");

      // A second connection with the same todo should fail.
      const { res, body } = await createConnection(
        [todo1.id, todo3.id],
        "Second"
      );

      expect(res.status).toBe(400);
      expect(body.error).toContain("at most 1 connection");
    });

    it("should return 400 for duplicate todoIds", async () => {
      const todo1 = await createTodo(testGroupId, "duplicate test");

      const { res, body } = await createConnection([todo1.id, todo1.id]);

      expect(res.status).toBe(400);
      expect(body.error).toContain("Duplicate");
    });

    it("should return 400 for invalid JSON body", async () => {
      const res = await ctx.app.request("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("Invalid JSON");
    });

    it("should return 400 for invalid kind", async () => {
      const todo1 = await createTodo(testGroupId, "task a");
      const todo2 = await createTodo(testGroupId, "task b");

      const res = await ctx.app.request("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoIds: [todo1.id, todo2.id], kind: "invalid" }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("kind must be one of");
    });
  });

  // ─── GET /api/connections ─────────────────────────

  describe("GET /api/connections", () => {
    it("should return an empty list when no connections exist", async () => {
      const res = await ctx.app.request("/api/connections");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it("should return all connections with progress", async () => {
      const todo1 = await createTodo(testGroupId, "task 1");
      const todo2 = await createTodo(testGroupId, "task 2");
      const todo3 = await createTodo(testGroupId, "task 3");
      const todo4 = await createTodo(testGroupId, "task 4");

      await createConnection([todo1.id, todo2.id], "Connection A");
      await createConnection([todo3.id, todo4.id], "Connection B");

      const res = await ctx.app.request("/api/connections");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].name).toBe("Connection A");
      expect(body.data[1].name).toBe("Connection B");
      expect(body.data[0].progress.total).toBe(2);
      expect(body.data[0].progress.completed).toBe(0);
    });

    it("should reflect correct progress when todos are completed", async () => {
      const todo1 = await createTodo(testGroupId, "complete me");
      const todo2 = await createTodo(testGroupId, "leave me");

      await createConnection([todo1.id, todo2.id], "Progress Test");

      // Complete todo1
      await completeTodo(todo1.id);

      const res = await ctx.app.request("/api/connections");
      const body = await res.json();

      expect(body.data[0].progress.total).toBe(2);
      expect(body.data[0].progress.completed).toBe(1);
      expect(body.data[0].progress.percentage).toBe(50);
      expect(body.data[0].is_fully_complete).toBe(false);
      const completedItem = body.data[0].items.find((item: any) => item.todo_id === todo1.id);
      expect(completedItem?.completed_at).toBeTruthy();
    });

    it("should show is_fully_complete when all todos are completed", async () => {
      const todo1 = await createTodo(testGroupId, "done 1");
      const todo2 = await createTodo(testGroupId, "done 2");

      await createConnection([todo1.id, todo2.id], "All Done");

      // Complete both
      await completeTodo(todo1.id);
      await completeTodo(todo2.id);

      const res = await ctx.app.request("/api/connections");
      const body = await res.json();

      expect(body.data[0].progress.completed).toBe(2);
      expect(body.data[0].progress.percentage).toBe(100);
      expect(body.data[0].is_fully_complete).toBe(true);
    });

    it("should exclude soft-deleted todos from progress calculation", async () => {
      const todo1 = await createTodo(testGroupId, "keep");
      const todo2 = await createTodo(testGroupId, "delete me");

      await createConnection([todo1.id, todo2.id], "Partial");

      // Complete todo1
      await completeTodo(todo1.id);

      // Soft-delete todo2
      await ctx.app.request(`/api/todos/${todo2.id}`, { method: "DELETE" });

      const res = await ctx.app.request("/api/connections");
      const body = await res.json();

      // Only 1 non-deleted item remaining
      expect(body.data[0].progress.total).toBe(1);
      expect(body.data[0].progress.completed).toBe(1);
      expect(body.data[0].progress.percentage).toBe(100);
      expect(body.data[0].is_fully_complete).toBe(true);
    });
  });

  // ─── GET /api/connections/:id ─────────────────────────

  describe("GET /api/connections/:id", () => {
    it("should return a single connection with items and progress", async () => {
      const todo1 = await createTodo(testGroupId, "item a");
      const todo2 = await createTodo(testGroupId, "item b");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "My Connection"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(`/api/connections/${connectionId}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.id).toBe(connectionId);
      expect(body.data.name).toBe("My Connection");
      expect(body.data.items).toHaveLength(2);
      expect(body.data.progress.total).toBe(2);
      expect(body.data.progress.completed).toBe(0);
    });

    it("should return 404 for non-existent connection", async () => {
      const res = await ctx.app.request(`/api/connections/${uuidv4()}`);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Connection not found");
    });
  });

  // ─── PATCH /api/connections/:id ─────────────────────────

  describe("PATCH /api/connections/:id", () => {
    it("should update connection name", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "Original"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated Name" }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.name).toBe("Updated Name");
      expect(body.data.kind).toBe("sequence");
      expect(body.data.items).toHaveLength(2);
    });

    it("should update connection kind", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "Original",
        "sequence"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(`/api/connections/${connectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "branch" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.kind).toBe("branch");
      expect(body.data.name).toBe("Original");
    });

    it("should allow setting name to null", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "Has Name"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: null }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.name).toBeNull();
    });

    it("should return 404 for non-existent connection", async () => {
      const res = await ctx.app.request(
        `/api/connections/${uuidv4()}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test" }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Connection not found");
    });

    it("should return 400 if name field is missing", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("At least one of name or kind");
    });

    it("should reject invalid kind updates", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection([todo1.id, todo2.id]);
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(`/api/connections/${connectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "unknown" }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("kind must be one of");
    });
  });

  // ─── POST /api/connections/merge ─────────────────────────

  describe("POST /api/connections/merge", () => {
    it("should merge two endpoint-connected chains into one", async () => {
      const a = await createTodo(testGroupId, "a");
      const b = await createTodo(testGroupId, "b");
      const c = await createTodo(testGroupId, "c");
      const d = await createTodo(testGroupId, "d");
      const e = await createTodo(testGroupId, "e");

      await createConnection([a.id, b.id, c.id], "Chain 1");
      await createConnection([d.id, e.id], "Chain 2");

      const res = await ctx.app.request("/api/connections/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromTodoId: c.id, toTodoId: d.id }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.items.map((i: any) => i.todo_id)).toEqual([
        a.id,
        b.id,
        c.id,
        d.id,
        e.id,
      ]);

      const listRes = await ctx.app.request("/api/connections");
      const listBody = await listRes.json();
      expect(listBody.data).toHaveLength(1);
    });

    it("should reject merge when a selected todo is not an endpoint", async () => {
      const a = await createTodo(testGroupId, "a");
      const b = await createTodo(testGroupId, "b");
      const c = await createTodo(testGroupId, "c");
      const d = await createTodo(testGroupId, "d");
      const e = await createTodo(testGroupId, "e");

      await createConnection([a.id, b.id, c.id], "Chain 1");
      await createConnection([d.id, e.id], "Chain 2");

      const res = await ctx.app.request("/api/connections/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromTodoId: b.id, toTodoId: d.id }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("endpoint");
    });

    it("should reject merging an existing branch tree", async () => {
      const root = await createTodo(testGroupId, "root");
      const branch = await createTodo(testGroupId, "branch");
      const seqA = await createTodo(testGroupId, "seq a");
      const seqB = await createTodo(testGroupId, "seq b");

      await createConnection([root.id, branch.id], "Branch Tree", "branch");
      await createConnection([seqA.id, seqB.id], "Sequence");

      const res = await ctx.app.request("/api/connections/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromTodoId: branch.id, toTodoId: seqA.id }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("branch trees");
    });
  });

  // ─── POST /api/connections/:id/cut ─────────────────────────

  describe("POST /api/connections/:id/cut", () => {
    it("should split a connection into two when cutting an interior edge", async () => {
      const a = await createTodo(testGroupId, "a");
      const b = await createTodo(testGroupId, "b");
      const c = await createTodo(testGroupId, "c");
      const d = await createTodo(testGroupId, "d");

      const { body: createBody } = await createConnection([a.id, b.id, c.id, d.id], "Chain");
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(`/api/connections/${connectionId}/cut`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromTodoId: b.id, toTodoId: c.id }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.left.items.map((i: any) => i.todo_id)).toEqual([a.id, b.id]);
      expect(body.data.right.items.map((i: any) => i.todo_id)).toEqual([c.id, d.id]);

      const listRes = await ctx.app.request("/api/connections");
      const listBody = await listRes.json();
      expect(listBody.data).toHaveLength(2);
    });

    it("should reject cutting a branch tree", async () => {
      const root = await createTodo(testGroupId, "root");
      const child = await createTodo(testGroupId, "child");

      const { body: createBody } = await createConnection([root.id, child.id], "Branch Tree", "branch");
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(`/api/connections/${connectionId}/cut`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromTodoId: root.id, toTodoId: child.id }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("not supported for branch trees");
    });
  });

  // ─── POST /api/connections/:id/items ─────────────────────────

  describe("POST /api/connections/:id/items", () => {
    it("should add a todo to an existing connection", async () => {
      const todo1 = await createTodo(testGroupId, "first");
      const todo2 = await createTodo(testGroupId, "second");
      const todo3 = await createTodo(testGroupId, "third");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "Expandable"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todoId: todo3.id }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.items).toHaveLength(3);
      expect(body.data.items[2].todo_id).toBe(todo3.id);
      expect(body.data.items[2].position).toBe(2);
      expect(body.data.progress.total).toBe(3);
    });

    it("should return 404 for non-existent connection", async () => {
      const todo = await createTodo(testGroupId, "orphan");

      const res = await ctx.app.request(
        `/api/connections/${uuidv4()}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todoId: todo.id }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Connection not found");
    });

    it("should return 404 for non-existent todo", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todoId: uuidv4() }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain("not found");
    });

    it("should return 400 if todo already belongs to a connection", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");
      const todo3 = await createTodo(testGroupId, "t3");

      await createConnection(
        [todo1.id, todo2.id],
        "Conn1"
      );
      const { body: conn2Body } = await createConnection(
        [todo3.id, (await createTodo(testGroupId, "t4")).id],
        "Conn2"
      );

      const res = await ctx.app.request(
        `/api/connections/${conn2Body.data.id}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todoId: todo1.id }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("at most 1 connection");
    });

    it("should return 400 if todoId is missing", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("todoId is required");
    });

    it("should return 404 if todo is soft-deleted", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");
      const todo3 = await createTodo(testGroupId, "deleted todo");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      // Soft-delete todo3
      await ctx.app.request(`/api/todos/${todo3.id}`, { method: "DELETE" });

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todoId: todo3.id }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain("not found or is deleted");
    });

    it("should add a nested branch child and preserve preorder", async () => {
      const root = await createTodo(testGroupId, "root");
      const child = await createTodo(testGroupId, "child");
      const grandchild = await createTodo(testGroupId, "grandchild");

      const { body: createBody } = await createConnection([root.id, child.id], "Branch Tree", "branch");
      const connectionId = createBody.data.id;

      const { res, body } = await addConnectionItem(connectionId, grandchild.id, child.id);

      expect(res.status).toBe(200);
      expect(body.data.items.map((item: any) => item.todo_id)).toEqual([root.id, child.id, grandchild.id]);
      expect(body.data.items[0].parent_todo_id).toBeNull();
      expect(body.data.items[1].parent_todo_id).toBe(root.id);
      expect(body.data.items[2].parent_todo_id).toBe(child.id);
      expect(body.data.progress.available_count).toBe(1);
      expect(body.data.progress.blocked_count).toBe(2);
      expect(body.data.progress.next_available_item_id).toBe(root.id);

      await completeTodo(root.id);

      const detailRes = await ctx.app.request(`/api/connections/${connectionId}`);
      const detailBody = await detailRes.json();
      expect(detailBody.data.progress.available_count).toBe(1);
      expect(detailBody.data.progress.blocked_count).toBe(1);
      expect(detailBody.data.progress.next_available_item_id).toBe(child.id);
    });

    it("should reject adding a third child under the same branch parent", async () => {
      const root = await createTodo(testGroupId, "root");
      const childA = await createTodo(testGroupId, "child a");
      const childB = await createTodo(testGroupId, "child b");
      const childC = await createTodo(testGroupId, "child c");

      const { body: createBody } = await createConnection(
        [root.id, childA.id, childB.id],
        "Wide Branch",
        "branch"
      );
      const connectionId = createBody.data.id;

      const { res, body } = await addConnectionItem(connectionId, childC.id, root.id);

      expect(res.status).toBe(400);
      expect(body.error).toContain("at most 2 children");
    });

    it("should allow a branch chain up to depth 7 and reject an eighth node", async () => {
      const root = await createTodo(testGroupId, "root");
      const level2 = await createTodo(testGroupId, "level 2");
      const level3 = await createTodo(testGroupId, "level 3");
      const level4 = await createTodo(testGroupId, "level 4");
      const level5 = await createTodo(testGroupId, "level 5");
      const level6 = await createTodo(testGroupId, "level 6");
      const level7 = await createTodo(testGroupId, "level 7");
      const level8 = await createTodo(testGroupId, "level 8");

      const { body: createBody } = await createConnection([root.id, level2.id], "Deep Branch", "branch");
      const connectionId = createBody.data.id;

      let addResult = await addConnectionItem(connectionId, level3.id, level2.id);
      expect(addResult.res.status).toBe(200);
      addResult = await addConnectionItem(connectionId, level4.id, level3.id);
      expect(addResult.res.status).toBe(200);
      addResult = await addConnectionItem(connectionId, level5.id, level4.id);
      expect(addResult.res.status).toBe(200);
      addResult = await addConnectionItem(connectionId, level6.id, level5.id);
      expect(addResult.res.status).toBe(200);
      addResult = await addConnectionItem(connectionId, level7.id, level6.id);
      expect(addResult.res.status).toBe(200);

      const { res, body } = await addConnectionItem(connectionId, level8.id, level7.id);

      expect(res.status).toBe(400);
      expect(body.error).toContain("at most 7 items");
    });
  });

  // ─── DELETE /api/connections/:id/items/:todoId ─────────────────────────

  describe("DELETE /api/connections/:id/items/:todoId", () => {
    it("should remove a todo from a connection", async () => {
      const todo1 = await createTodo(testGroupId, "keep");
      const todo2 = await createTodo(testGroupId, "remove");
      const todo3 = await createTodo(testGroupId, "keep too");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id, todo3.id],
        "Shrinkable"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items/${todo2.id}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.items).toHaveLength(2);
      // todo2 should no longer be in the items
      const todoIds = body.data.items.map((i: any) => i.todo_id);
      expect(todoIds).not.toContain(todo2.id);
      expect(todoIds).toContain(todo1.id);
      expect(todoIds).toContain(todo3.id);
    });

    it("should NOT delete the todo itself when removing from connection", async () => {
      const todo1 = await createTodo(testGroupId, "keep");
      const todo2 = await createTodo(testGroupId, "remove from conn");
      const todo3 = await createTodo(testGroupId, "another");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id, todo3.id]
      );
      const connectionId = createBody.data.id;

      await ctx.app.request(
        `/api/connections/${connectionId}/items/${todo2.id}`,
        { method: "DELETE" }
      );

      // todo2 should still exist as a standalone todo
      const todoRes = await ctx.app.request(`/api/todos/${todo2.id}`);
      const todoBody = await todoRes.json();

      expect(todoRes.status).toBe(200);
      expect(todoBody.data.id).toBe(todo2.id);
    });

    it("should auto-delete connection when removing an item from a 2-item connection", async () => {
      const todo1 = await createTodo(testGroupId, "last one");
      const todo2 = await createTodo(testGroupId, "second");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "Will Die"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items/${todo1.id}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.message).toContain("Connection deleted");

      // Connection should no longer exist
      const getRes = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      expect(getRes.status).toBe(404);
    });

    it("should return 404 for non-existent connection", async () => {
      const todo = await createTodo(testGroupId, "orphan");

      const res = await ctx.app.request(
        `/api/connections/${uuidv4()}/items/${todo.id}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Connection not found");
    });

    it("should return 404 if todo is not part of the connection", async () => {
      const todo1 = await createTodo(testGroupId, "in conn");
      const todo2 = await createTodo(testGroupId, "also in conn");
      const todo3 = await createTodo(testGroupId, "not in conn");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items/${todo3.id}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain("not part of this connection");
    });

    it("should reject removing the root of a branch tree", async () => {
      const root = await createTodo(testGroupId, "root");
      const child = await createTodo(testGroupId, "child");

      const { body: createBody } = await createConnection([root.id, child.id], "Branch Tree", "branch");
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items/${root.id}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("Cannot remove the root");
    });

    it("should reject removing a non-leaf branch node", async () => {
      const root = await createTodo(testGroupId, "root");
      const child = await createTodo(testGroupId, "child");
      const grandchild = await createTodo(testGroupId, "grandchild");

      const { body: createBody } = await createConnection([root.id, child.id], "Branch Tree", "branch");
      const connectionId = createBody.data.id;
      await addConnectionItem(connectionId, grandchild.id, child.id);

      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items/${child.id}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("Only leaf branch nodes can be removed");
    });
  });

  // ─── DELETE /api/connections/:id ─────────────────────────

  describe("DELETE /api/connections/:id", () => {
    it("should delete a connection without deleting the todos", async () => {
      const todo1 = await createTodo(testGroupId, "survives");
      const todo2 = await createTodo(testGroupId, "also survives");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "Deletable"
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.message).toBe("Connection deleted successfully");

      // Connection should be gone
      const getRes = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      expect(getRes.status).toBe(404);

      // But todos should still exist
      const todo1Res = await ctx.app.request(`/api/todos/${todo1.id}`);
      expect(todo1Res.status).toBe(200);

      const todo2Res = await ctx.app.request(`/api/todos/${todo2.id}`);
      expect(todo2Res.status).toBe(200);
    });

    it("should remove all connection_items when deleting connection", async () => {
      const todo1 = await createTodo(testGroupId, "t1");
      const todo2 = await createTodo(testGroupId, "t2");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      await ctx.app.request(`/api/connections/${connectionId}`, {
        method: "DELETE",
      });

      // Verify no connection_items remain for this connection
      const items = ctx.db
        .select()
        .from(connectionItems)
        .where(eq(connectionItems.connection_id, connectionId))
        .all();
      expect(items).toHaveLength(0);
    });

    it("should allow todo to join another connection after deletion", async () => {
      const todo1 = await createTodo(testGroupId, "reusable 1");
      const todo2 = await createTodo(testGroupId, "reusable 2");
      const todo3 = await createTodo(testGroupId, "new partner");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "First"
      );
      const connectionId = createBody.data.id;

      // Delete the connection
      await ctx.app.request(`/api/connections/${connectionId}`, {
        method: "DELETE",
      });

      // Now todo1 should be free to join a new connection
      const { res, body } = await createConnection(
        [todo1.id, todo3.id],
        "Second"
      );

      expect(res.status).toBe(201);
      expect(body.data.items).toHaveLength(2);
    });

    it("should return 404 for non-existent connection", async () => {
      const res = await ctx.app.request(
        `/api/connections/${uuidv4()}`,
        { method: "DELETE" }
      );
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Connection not found");
    });
  });

  // ─── Progress Calculation ─────────────────────────

  describe("Progress calculation", () => {
    it("should show 0% when no todos are completed", async () => {
      const todo1 = await createTodo(testGroupId, "a");
      const todo2 = await createTodo(testGroupId, "b");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      const body = await res.json();

      expect(body.data.progress.percentage).toBe(0);
      expect(body.data.is_fully_complete).toBe(false);
    });

    it("should show 50% when half todos are completed", async () => {
      const todo1 = await createTodo(testGroupId, "a");
      const todo2 = await createTodo(testGroupId, "b");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      await completeTodo(todo1.id);

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      const body = await res.json();

      expect(body.data.progress.percentage).toBe(50);
      expect(body.data.is_fully_complete).toBe(false);
    });

    it("should show 100% and is_fully_complete when all todos completed", async () => {
      const todo1 = await createTodo(testGroupId, "a");
      const todo2 = await createTodo(testGroupId, "b");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      await completeTodo(todo1.id);
      await completeTodo(todo2.id);

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      const body = await res.json();

      expect(body.data.progress.percentage).toBe(100);
      expect(body.data.is_fully_complete).toBe(true);
    });

    it("should handle toggling completion back to incomplete", async () => {
      const todo1 = await createTodo(testGroupId, "toggle me");
      const todo2 = await createTodo(testGroupId, "stay");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      // Complete todo1
      await completeTodo(todo1.id);

      // Verify 50%
      let res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      let body = await res.json();
      expect(body.data.progress.percentage).toBe(50);

      // Uncomplete todo1 (toggle)
      await completeTodo(todo1.id);

      // Verify back to 0%
      res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      body = await res.json();
      expect(body.data.progress.percentage).toBe(0);
      expect(body.data.is_fully_complete).toBe(false);
    });

    it("should round percentage correctly (e.g., 1 of 3 = 33%)", async () => {
      const todo1 = await createTodo(testGroupId, "a");
      const todo2 = await createTodo(testGroupId, "b");
      const todo3 = await createTodo(testGroupId, "c");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id, todo3.id]
      );
      const connectionId = createBody.data.id;

      await completeTodo(todo1.id);

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      const body = await res.json();

      // 1/3 = 0.333... → Math.round = 33
      expect(body.data.progress.percentage).toBe(33);
    });

    it("should round 2 of 3 to 67%", async () => {
      const todo1 = await createTodo(testGroupId, "a");
      const todo2 = await createTodo(testGroupId, "b");
      const todo3 = await createTodo(testGroupId, "c");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id, todo3.id]
      );
      const connectionId = createBody.data.id;

      await completeTodo(todo1.id);
      await completeTodo(todo2.id);

      const res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      const body = await res.json();

      // 2/3 = 0.666... → Math.round = 67
      expect(body.data.progress.percentage).toBe(67);
    });

    it("should report blocked and available counts for dependency connections", async () => {
      const todo1 = await createTodo(testGroupId, "blocker");
      const todo2 = await createTodo(testGroupId, "middle");
      const todo3 = await createTodo(testGroupId, "final");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id, todo3.id],
        "Dependency Chain",
        "dependency"
      );
      const connectionId = createBody.data.id;

      let res = await ctx.app.request(`/api/connections/${connectionId}`);
      let body = await res.json();
      expect(body.data.progress.available_count).toBe(1);
      expect(body.data.progress.blocked_count).toBe(2);
      expect(body.data.progress.next_available_item_id).toBe(todo1.id);

      await completeTodo(todo1.id);

      res = await ctx.app.request(`/api/connections/${connectionId}`);
      body = await res.json();
      expect(body.data.progress.available_count).toBe(1);
      expect(body.data.progress.blocked_count).toBe(1);
      expect(body.data.progress.next_available_item_id).toBe(todo2.id);
    });
  });

  describe("Branch rules", () => {
    it("should create flat legacy branch items with root parent links", async () => {
      const todo1 = await createTodo(testGroupId, "root");
      const todo2 = await createTodo(testGroupId, "branch a");
      const todo3 = await createTodo(testGroupId, "branch b");

      const { res, body } = await createConnection(
        [todo1.id, todo2.id, todo3.id],
        "Flat Branch",
        "branch"
      );

      expect(res.status).toBe(201);
      expect(body.data.items[0].parent_todo_id).toBeNull();
      expect(body.data.items[1].parent_todo_id).toBe(todo1.id);
      expect(body.data.items[2].parent_todo_id).toBe(todo1.id);
      expect(body.data.progress.available_count).toBe(1);
      expect(body.data.progress.blocked_count).toBe(2);
      expect(body.data.progress.next_available_item_id).toBe(todo1.id);
    });
  });

  // ─── Uniqueness Constraint ─────────────────────────

  describe("Uniqueness: todo can belong to at most one connection", () => {
    it("should enforce that a todo cannot be in more than one connection", async () => {
      const todo1 = await createTodo(testGroupId, "shared");
      const todo2 = await createTodo(testGroupId, "partner a");
      const todo3 = await createTodo(testGroupId, "partner b");

      // First connection with todo1
      await createConnection([todo1.id, todo2.id], "Conn 1");

      // A second connection with todo1 should fail.
      const { res, body } = await createConnection(
        [todo1.id, todo3.id],
        "Conn 2"
      );

      expect(res.status).toBe(400);
      expect(body.error).toContain("at most 1 connection");
    });

    it("should return 400 when adding todo already in this connection", async () => {
      const todo1 = await createTodo(testGroupId, "already in");
      const todo2 = await createTodo(testGroupId, "partner");

      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id]
      );
      const connectionId = createBody.data.id;

      // Try adding todo1 again to the same connection
      const res = await ctx.app.request(
        `/api/connections/${connectionId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todoId: todo1.id }),
        }
      );
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("already belongs to this connection");
    });
  });

  // ─── Integration: Full Workflow ─────────────────────────

  describe("Integration: Full connection workflow", () => {
    it("should support create -> add item -> complete items -> check progress -> delete", async () => {
      const todo1 = await createTodo(testGroupId, "step 1");
      const todo2 = await createTodo(testGroupId, "step 2");
      const todo3 = await createTodo(testGroupId, "step 3");

      // Create connection with 2 items
      const { body: createBody } = await createConnection(
        [todo1.id, todo2.id],
        "Workflow Test"
      );
      const connectionId = createBody.data.id;
      expect(createBody.data.items).toHaveLength(2);

      // Add a third item
      await ctx.app.request(
        `/api/connections/${connectionId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todoId: todo3.id }),
        }
      );

      // Complete 2 of 3
      await completeTodo(todo1.id);
      await completeTodo(todo2.id);

      // Check progress
      let res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      let body = await res.json();
      expect(body.data.progress.total).toBe(3);
      expect(body.data.progress.completed).toBe(2);
      expect(body.data.progress.percentage).toBe(67);
      expect(body.data.is_fully_complete).toBe(false);

      // Complete the last one
      await completeTodo(todo3.id);

      // Check fully complete
      res = await ctx.app.request(
        `/api/connections/${connectionId}`
      );
      body = await res.json();
      expect(body.data.progress.percentage).toBe(100);
      expect(body.data.is_fully_complete).toBe(true);

      // Delete the connection
      const deleteRes = await ctx.app.request(
        `/api/connections/${connectionId}`,
        { method: "DELETE" }
      );
      expect(deleteRes.status).toBe(200);

      // Todos should still exist
      const todo1Res = await ctx.app.request(`/api/todos/${todo1.id}`);
      expect(todo1Res.status).toBe(200);
    });

    it("should handle connection with todos from different groups", async () => {
      // Create a second group
      const group2Res = await ctx.app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Second Group" }),
      });
      const group2 = (await group2Res.json()).data;

      const todo1 = await createTodo(testGroupId, "group 1 task");
      const todo2 = await createTodo(group2.id, "group 2 task");

      const { res, body } = await createConnection(
        [todo1.id, todo2.id],
        "Cross-Group"
      );

      expect(res.status).toBe(201);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.items[0].title).toBe("Group 1 task");
      expect(body.data.items[1].title).toBe("Group 2 task");
    });
  });
});
