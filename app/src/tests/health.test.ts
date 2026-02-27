import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";

describe("Health Endpoint", () => {
  const app = createApp();

  it("GET /health should return { status: 'ok' } with 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /health should return JSON content type", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
