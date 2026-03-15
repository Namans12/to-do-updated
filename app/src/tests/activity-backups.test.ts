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
});
