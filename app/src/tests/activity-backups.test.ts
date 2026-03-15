import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { createTestContext } from "./helpers.js";

describe("Activity and backups API", () => {
  let ctx: ReturnType<typeof createTestContext>;
  const backupDir = path.join(process.cwd(), "data", "backups");

  beforeEach(() => {
    ctx = createTestContext();
    if (fs.existsSync(backupDir)) {
      for (const file of fs.readdirSync(backupDir)) {
        if (file.endsWith(".json")) {
          fs.unlinkSync(path.join(backupDir, file));
        }
      }
    }
  });

  afterEach(() => {
    ctx.cleanup();
    if (fs.existsSync(backupDir)) {
      for (const file of fs.readdirSync(backupDir)) {
        if (file.endsWith(".json")) {
          fs.unlinkSync(path.join(backupDir, file));
        }
      }
    }
  });

  it("logs todo activity and returns it from the activity feed", async () => {
    const groupRes = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Activity Group" }),
    });
    const groupBody = await groupRes.json();

    await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Logged task" }),
    });

    const activityRes = await ctx.app.request("/api/activity");
    const activityBody = await activityRes.json();

    expect(activityRes.status).toBe(200);
    expect(activityBody.data.some((entry: any) => entry.action === "created" && entry.entity_type === "todo")).toBe(true);
  });

  it("returns entity history for a specific task", async () => {
    const groupRes = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "History Group" }),
    });
    const groupBody = await groupRes.json();

    const todoRes = await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "History Task" }),
    });
    const todoBody = await todoRes.json();

    await ctx.app.request(`/api/todos/${todoBody.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Changed once" }),
    });

    const historyRes = await ctx.app.request(`/api/activity/todo/${todoBody.data.id}`);
    const historyBody = await historyRes.json();

    expect(historyRes.status).toBe(200);
    expect(historyBody.data.length).toBeGreaterThanOrEqual(2);
    expect(historyBody.data[0].entity_id).toBe(todoBody.data.id);
  });

  it("creates, lists, restores, and deletes backups", async () => {
    const groupRes = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Backup Group" }),
    });
    const groupBody = await groupRes.json();

    await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Before backup" }),
    });

    const createRes = await ctx.app.request("/api/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Test snapshot" }),
    });
    const createBody = await createRes.json();
    expect(createRes.status).toBe(201);

    await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "After backup" }),
    });

    const restoreRes = await ctx.app.request(`/api/backups/${createBody.data.id}/restore`, {
      method: "POST",
    });
    expect(restoreRes.status).toBe(200);

    const listTodosRes = await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`);
    const listTodosBody = await listTodosRes.json();
    expect(listTodosBody.data).toHaveLength(1);
    expect(listTodosBody.data[0].title).toBe("Before backup");

    const listBackupsRes = await ctx.app.request("/api/backups");
    const listBackupsBody = await listBackupsRes.json();
    expect(listBackupsBody.data).toHaveLength(1);

    const deleteRes = await ctx.app.request(`/api/backups/${createBody.data.id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
  });

  it("restores a single task from a backup snapshot", async () => {
    const groupRes = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Single Restore Group" }),
    });
    const groupBody = await groupRes.json();

    const todoRes = await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Restore Me", description: "Before" }),
    });
    const todoBody = await todoRes.json();

    const backupRes = await ctx.app.request("/api/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Single restore snapshot" }),
    });
    const backupBody = await backupRes.json();

    await ctx.app.request(`/api/todos/${todoBody.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "After" }),
    });

    const previewRes = await ctx.app.request(
      `/api/backups/${backupBody.data.id}/todos/${todoBody.data.id}`
    );
    const previewBody = await previewRes.json();
    expect(previewRes.status).toBe(200);
    expect(previewBody.data.backup.description).toBe("Before");
    expect(previewBody.data.current.description).toBe("After");

    const restoreRes = await ctx.app.request(
      `/api/backups/${backupBody.data.id}/todos/${todoBody.data.id}/restore`,
      { method: "POST" }
    );
    const restoreBody = await restoreRes.json();
    expect(restoreRes.status).toBe(200);
    expect(restoreBody.data.description).toBe("Before");
  });

  it("creates, applies, and deletes templates", async () => {
    const sourceGroupRes = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Template Source" }),
    });
    const sourceGroupBody = await sourceGroupRes.json();

    const parentRes = await ctx.app.request(`/api/groups/${sourceGroupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Template Parent", planning_level: 2 }),
    });
    const parentBody = await parentRes.json();
    const childRes = await ctx.app.request(`/api/groups/${sourceGroupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Template Child", parent_todo_id: parentBody.data.id }),
    });
    const childBody = await childRes.json();

    await ctx.app.request("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        todoIds: [parentBody.data.id, childBody.data.id],
        kind: "dependency",
      }),
    });

    const templateRes = await ctx.app.request("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_group_id: sourceGroupBody.data.id, name: "Weekly Board" }),
    });
    const templateBody = await templateRes.json();
    expect(templateRes.status).toBe(201);

    const targetGroupRes = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Template Target" }),
    });
    const targetGroupBody = await targetGroupRes.json();

    const applyRes = await ctx.app.request(`/api/templates/${templateBody.data.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: targetGroupBody.data.id }),
    });
    const applyBody = await applyRes.json();
    expect(applyRes.status).toBe(200);
    expect(applyBody.data.created_todo_count).toBe(2);

    const targetTodosRes = await ctx.app.request(`/api/groups/${targetGroupBody.data.id}/todos`);
    const targetTodosBody = await targetTodosRes.json();
    expect(targetTodosBody.data).toHaveLength(2);

    const deleteTemplateRes = await ctx.app.request(`/api/templates/${templateBody.data.id}`, {
      method: "DELETE",
    });
    expect(deleteTemplateRes.status).toBe(200);
  });
});
