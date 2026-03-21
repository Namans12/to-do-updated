import { expect, test } from "@playwright/test";

test("supabase hosted mode shows auth screen when signed out", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Live Sync Workspace", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with password" })).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
});
