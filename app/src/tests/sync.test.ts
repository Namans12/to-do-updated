import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "./helpers.js";

describe("Sync API", () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("exports a sync package and restores it through import", async () => {
    const groupRes = await ctx.app.request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sync Group" }),
    });
    const groupBody = await groupRes.json();

    await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Keep me synced" }),
    });

    const exportRes = await ctx.app.request("/api/sync/export?device_name=Laptop");
    const exportBody = await exportRes.json();
    expect(exportRes.status).toBe(200);
    expect(exportBody.data.device_name).toBe("Laptop");
    expect(exportBody.data.snapshot.todos).toHaveLength(1);

    await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "After export" }),
    });

    const importRes = await ctx.app.request("/api/sync/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportBody.data),
    });
    const importBody = await importRes.json();
    expect(importRes.status).toBe(200);
    expect(importBody.data.counts.todos).toBe(1);

    const listTodosRes = await ctx.app.request(`/api/groups/${groupBody.data.id}/todos`);
    const listTodosBody = await listTodosRes.json();
    expect(listTodosBody.data).toHaveLength(1);
    expect(listTodosBody.data[0].title).toBe("Keep me synced");
  });

  it("rejects invalid sync payloads", async () => {
    const res = await ctx.app.request("/api/sync/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid sync package");
  });
});
