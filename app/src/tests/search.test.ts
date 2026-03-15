import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestContext } from "./helpers.js";
import { connectionItems, connections, groups, todos } from "../db/schema.js";
import { v4 as uuid } from "uuid";

describe("Search API - GET /api/search", () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Helper to create a group
  function createGroup(name: string, position = 0) {
    const id = uuid();
    const now = new Date().toISOString();
    ctx.db.insert(groups).values({
      id,
      name,
      position,
      created_at: now,
      updated_at: now,
    }).run();
    return id;
  }

  // Helper to create a todo
  function createTodo(
    groupId: string,
    title: string,
    options: {
      description?: string | null;
      high_priority?: number;
      reminder_at?: string | null;
      recurrence_rule?: string | null;
      planning_level?: number;
      is_completed?: number;
      deleted_at?: string | null;
      position?: number;
      created_at?: string;
      updated_at?: string;
    } = {}
  ) {
    const id = uuid();
    const now = options.created_at ?? new Date().toISOString();
    ctx.db.insert(todos).values({
      id,
      group_id: groupId,
      title,
      description: options.description ?? null,
      high_priority: options.high_priority ?? 0,
      reminder_at: options.reminder_at ?? null,
      recurrence_rule: options.recurrence_rule ?? null,
      recurrence_enabled: options.recurrence_rule ? 1 : 0,
      next_occurrence_at: options.recurrence_rule ? (options.reminder_at ?? now) : null,
      is_completed: options.is_completed ?? 0,
      position: options.position ?? 0,
      parent_todo_id: null,
      planning_level: options.planning_level ?? 0,
      deleted_at: options.deleted_at ?? null,
      created_at: now,
      updated_at: options.updated_at ?? now,
    }).run();
    return id;
  }

  function createConnection(kind: "sequence" | "dependency" | "branch" | "related", todoIds: string[]) {
    const connectionId = uuid();
    const createdAt = new Date().toISOString();
    ctx.db.insert(connections).values({
      id: connectionId,
      name: `${kind} link`,
      kind,
      created_at: createdAt,
    }).run();

    todoIds.forEach((todoId, index) => {
      ctx.db.insert(connectionItems).values({
        id: uuid(),
        connection_id: connectionId,
        todo_id: todoId,
        position: index,
      }).run();
    });
  }

  describe("Basic Search", () => {
    it("should return 400 when query parameter q is missing", async () => {
      const res = await ctx.app.request("/api/search");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("'q' is required");
    });

    it("should return 400 when query parameter q is empty", async () => {
      const res = await ctx.app.request("/api/search?q=");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("'q' is required");
    });

    it("should return 400 when query parameter q is whitespace only", async () => {
      const res = await ctx.app.request("/api/search?q=   ");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("'q' is required");
    });

    it("should return empty results when no todos match", async () => {
      const groupId = createGroup("Test Group");
      createTodo(groupId, "Buy groceries");

      const res = await ctx.app.request("/api/search?q=nonexistent");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.query).toBe("nonexistent");
      expect(body.data.count).toBe(0);
      expect(body.data.results).toEqual([]);
    });

    it("should find todos matching title", async () => {
      const groupId = createGroup("Work");
      createTodo(groupId, "Buy groceries");
      createTodo(groupId, "Fix the car");

      const res = await ctx.app.request("/api/search?q=groceries");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.query).toBe("groceries");
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Buy groceries");
    });

    it("should find todos matching description", async () => {
      const groupId = createGroup("Home");
      createTodo(groupId, "Shopping", { description: "Need to buy groceries and milk" });
      createTodo(groupId, "Exercise", { description: "Go for a run" });

      const res = await ctx.app.request("/api/search?q=milk");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Shopping");
      expect(body.data.results[0].description).toContain("milk");
    });

    it("should include group information in results", async () => {
      const groupId = createGroup("Personal");
      createTodo(groupId, "Read a book");

      const res = await ctx.app.request("/api/search?q=book");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.results[0].group).toEqual({
        id: groupId,
        name: "Personal",
      });
    });

    it("should return all expected fields in results", async () => {
      const groupId = createGroup("Work");
      const todoId = createTodo(groupId, "Complete project", {
        description: "Finish the quarterly report",
        is_completed: 1,
        position: 5,
      });

      const res = await ctx.app.request("/api/search?q=project");
      expect(res.status).toBe(200);
      const body = await res.json();
      const result = body.data.results[0];

      expect(result.id).toBe(todoId);
      expect(result.title).toBe("Complete project");
      expect(result.description).toBe("Finish the quarterly report");
      expect(result.is_completed).toBe(1);
      expect(result.position).toBe(5);
      expect(result.group.id).toBe(groupId);
      expect(result.group.name).toBe("Work");
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });
  });

  describe("Case-Insensitive Search", () => {
    it("should find lowercase match with uppercase query", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "buy groceries");

      const res = await ctx.app.request("/api/search?q=GROCERIES");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("buy groceries");
    });

    it("should find uppercase match with lowercase query", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "URGENT TASK");

      const res = await ctx.app.request("/api/search?q=urgent");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("URGENT TASK");
    });

    it("should find mixed case match with any case query", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Complete ProjectX Review");

      const res = await ctx.app.request("/api/search?q=PROJECTX");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
    });

    it("should be case-insensitive for description search", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Task", { description: "Important DEADLINE approaching" });

      const res = await ctx.app.request("/api/search?q=deadline");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
    });
  });

  describe("Filtering by Completion Status", () => {
    it("should filter by completed=true", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Completed task", { is_completed: 1 });
      createTodo(groupId, "Incomplete task", { is_completed: 0 });

      const res = await ctx.app.request("/api/search?q=task&completed=true");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Completed task");
      expect(body.data.results[0].is_completed).toBe(1);
    });

    it("should filter by completed=false", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Completed task", { is_completed: 1 });
      createTodo(groupId, "Incomplete task", { is_completed: 0 });

      const res = await ctx.app.request("/api/search?q=task&completed=false");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Incomplete task");
      expect(body.data.results[0].is_completed).toBe(0);
    });

    it("should return all todos when completed=all", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Completed task", { is_completed: 1 });
      createTodo(groupId, "Incomplete task", { is_completed: 0 });

      const res = await ctx.app.request("/api/search?q=task&completed=all");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(2);
    });

    it("should return all todos when completed is not specified", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Completed task", { is_completed: 1 });
      createTodo(groupId, "Incomplete task", { is_completed: 0 });

      const res = await ctx.app.request("/api/search?q=task");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(2);
    });
  });

  describe("Filtering by Group ID", () => {
    it("should filter results by group_id", async () => {
      const group1 = createGroup("Work");
      const group2 = createGroup("Home");
      createTodo(group1, "Work task");
      createTodo(group2, "Home task");

      const res = await ctx.app.request(`/api/search?q=task&group_id=${group1}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Work task");
      expect(body.data.results[0].group.id).toBe(group1);
    });

    it("should return 404 for non-existent group_id", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Some task");

      const res = await ctx.app.request(`/api/search?q=task&group_id=nonexistent-uuid`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Group not found");
    });

    it("should return empty results when group exists but has no matching todos", async () => {
      const group1 = createGroup("Work");
      const group2 = createGroup("Home");
      createTodo(group1, "Work task");

      const res = await ctx.app.request(`/api/search?q=task&group_id=${group2}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(0);
      expect(body.data.results).toEqual([]);
    });
  });

  describe("Combined Filters", () => {
    it("should combine completed and group_id filters", async () => {
      const group1 = createGroup("Work");
      const group2 = createGroup("Home");
      createTodo(group1, "Work task completed", { is_completed: 1 });
      createTodo(group1, "Work task pending", { is_completed: 0 });
      createTodo(group2, "Home task completed", { is_completed: 1 });

      const res = await ctx.app.request(`/api/search?q=task&completed=true&group_id=${group1}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Work task completed");
    });

    it("should filter by high priority, reminder, connection kind, and planning level", async () => {
      const groupId = createGroup("Advanced");
      const reminderAt = new Date(Date.now() + 60_000).toISOString();
      const matchingTodo = createTodo(groupId, "Advanced task", {
        high_priority: 1,
        reminder_at: reminderAt,
        recurrence_rule: "daily",
        planning_level: 3,
      });
      const otherTodo = createTodo(groupId, "Advanced other", {
        high_priority: 0,
        planning_level: 1,
      });
      createConnection("dependency", [matchingTodo, otherTodo]);

      const res = await ctx.app.request(
        `/api/search?q=Advanced&high_priority=true&has_reminder=true&connection_kind=dependency&planning_level=3`
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].id).toBe(matchingTodo);
      expect(body.data.results[0].connection_kind).toBe("dependency");
      expect(body.data.results[0].planning_level).toBe(3);
    });
  });

  describe("Soft-Deleted Todos", () => {
    it("should exclude soft-deleted todos from search results", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Active task");
      createTodo(groupId, "Deleted task", { deleted_at: new Date().toISOString() });

      const res = await ctx.app.request("/api/search?q=task");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Active task");
    });

    it("should not find soft-deleted todos even with exact match", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Specific unique title", { deleted_at: new Date().toISOString() });

      const res = await ctx.app.request("/api/search?q=Specific%20unique%20title");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(0);
    });
  });

  describe("Relevance Sorting", () => {
    it("should prioritize title matches over description matches", async () => {
      const groupId = createGroup("Test");
      // Create todos with same updated_at to focus on relevance sorting
      const baseTime = new Date("2024-01-01T12:00:00Z").toISOString();

      // This one matches in description only
      createTodo(groupId, "Task one", {
        description: "Contains the keyword shopping here",
        updated_at: baseTime,
        created_at: baseTime,
      });

      // This one matches in title
      createTodo(groupId, "Go shopping today", {
        description: "No keyword here",
        updated_at: baseTime,
        created_at: baseTime,
      });

      const res = await ctx.app.request("/api/search?q=shopping");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(2);
      // Title match should come first
      expect(body.data.results[0].title).toBe("Go shopping today");
      expect(body.data.results[1].title).toBe("Task one");
    });

    it("should sort by updated_at within same relevance category", async () => {
      const groupId = createGroup("Test");

      // Older todo
      createTodo(groupId, "Buy groceries older", {
        updated_at: "2024-01-01T12:00:00Z",
        created_at: "2024-01-01T12:00:00Z",
      });

      // Newer todo
      createTodo(groupId, "Buy groceries newer", {
        updated_at: "2024-06-01T12:00:00Z",
        created_at: "2024-06-01T12:00:00Z",
      });

      const res = await ctx.app.request("/api/search?q=groceries");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(2);
      // Newer should come first (descending by updated_at)
      expect(body.data.results[0].title).toBe("Buy groceries newer");
      expect(body.data.results[1].title).toBe("Buy groceries older");
    });

    it("should handle mixed title and description matches with proper ordering", async () => {
      const groupId = createGroup("Test");

      const t1 = "2024-01-01T12:00:00Z";
      const t2 = "2024-01-02T12:00:00Z";
      const t3 = "2024-01-03T12:00:00Z";
      const t4 = "2024-01-04T12:00:00Z";

      // Description match, older
      createTodo(groupId, "Task A", {
        description: "Has important info",
        updated_at: t1,
        created_at: t1,
      });

      // Title match, older
      createTodo(groupId, "Important task B", {
        updated_at: t2,
        created_at: t2,
      });

      // Description match, newer
      createTodo(groupId, "Task C", {
        description: "Also important details",
        updated_at: t3,
        created_at: t3,
      });

      // Title match, newer
      createTodo(groupId, "Another important task D", {
        updated_at: t4,
        created_at: t4,
      });

      const res = await ctx.app.request("/api/search?q=important");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(4);

      // Order should be: Title matches (newest first), then Description matches (newest first)
      expect(body.data.results[0].title).toBe("Another important task D"); // Title, newest
      expect(body.data.results[1].title).toBe("Important task B"); // Title, older
      expect(body.data.results[2].title).toBe("Task C"); // Description, newer
      expect(body.data.results[3].title).toBe("Task A"); // Description, older
    });
  });

  describe("Partial Matching", () => {
    it("should find partial matches in title", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Complete the documentation");

      const res = await ctx.app.request("/api/search?q=document");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Complete the documentation");
    });

    it("should find partial matches in description", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Task", { description: "Remember to authenticate the user" });

      const res = await ctx.app.request("/api/search?q=auth");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
    });

    it("should handle single character search", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "A simple task");
      createTodo(groupId, "Another item");

      const res = await ctx.app.request("/api/search?q=A");
      expect(res.status).toBe(200);
      const body = await res.json();
      // Both contain 'A' or 'a'
      expect(body.data.count).toBe(2);
    });
  });

  describe("Special Characters", () => {
    it("should handle search with special characters", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Task with @ symbol");
      createTodo(groupId, "Task with # hashtag");

      const res = await ctx.app.request("/api/search?q=@");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Task with @ symbol");
    });

    it("should handle search with percent sign", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "100% complete");

      // URL encode the percent sign
      const res = await ctx.app.request("/api/search?q=%25");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
    });

    it("should handle search with spaces", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Buy milk and eggs");
      createTodo(groupId, "Milk delivery");

      const res = await ctx.app.request("/api/search?q=buy%20milk");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].title).toBe("Buy milk and eggs");
    });
  });

  describe("Multiple Groups", () => {
    it("should search across all groups when group_id not specified", async () => {
      const group1 = createGroup("Work");
      const group2 = createGroup("Home");
      const group3 = createGroup("Personal");

      createTodo(group1, "Work report");
      createTodo(group2, "Home report");
      createTodo(group3, "Personal report");

      const res = await ctx.app.request("/api/search?q=report");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(3);

      // Verify different groups are represented
      const groupNames = body.data.results.map((r: any) => r.group.name);
      expect(groupNames).toContain("Work");
      expect(groupNames).toContain("Home");
      expect(groupNames).toContain("Personal");
    });
  });

  describe("Edge Cases", () => {
    it("should handle todos with null descriptions", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Task without description", { description: null });

      const res = await ctx.app.request("/api/search?q=Task");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
      expect(body.data.results[0].description).toBeNull();
    });

    it("should handle very long search queries", async () => {
      const groupId = createGroup("Test");
      const longTitle = "A".repeat(500);
      createTodo(groupId, longTitle);

      const res = await ctx.app.request(`/api/search?q=${"A".repeat(100)}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.count).toBe(1);
    });

    it("should trim whitespace from query", async () => {
      const groupId = createGroup("Test");
      createTodo(groupId, "Important task");

      const res = await ctx.app.request("/api/search?q=%20%20Important%20%20");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.query).toBe("Important"); // Trimmed
      expect(body.data.count).toBe(1);
    });
  });
});
