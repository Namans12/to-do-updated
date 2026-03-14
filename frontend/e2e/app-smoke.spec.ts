import { expect, test } from "@playwright/test";

test("main app flow covers shortcuts, reminders, and connection meaning", async ({ page }) => {
  const unique = Date.now();
  const groupName = `E2E Group ${unique}`;
  const firstTodo = `Plan launch ${unique}`;
  const secondTodo = `Ship checklist ${unique}`;
  const reminderDate = new Date(Date.now() + 86_400_000);
  const yyyy = reminderDate.getFullYear();
  const mm = String(reminderDate.getMonth() + 1).padStart(2, "0");
  const dd = String(reminderDate.getDate()).padStart(2, "0");
  const dateValue = `${yyyy}-${mm}-${dd}`;

  await page.goto("/");

  await page.getByRole("button", { name: "Create group" }).click().catch(() => undefined);
  await page.getByPlaceholder("Group name...").fill(groupName);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: groupName, exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Add a to-do/i }).click();
  await page.locator("[data-new-todo-input='true']").fill(firstTodo);
  await page.getByLabel("Reminder").check();
  await page.locator("input[type='date']").last().fill(dateValue);
  await page.locator("input[type='time']").last().fill("10:30");
  await page.locator("[data-new-todo-input='true']").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(firstTodo)).toBeVisible();

  await page.locator("[data-new-todo-input='true']").fill(secondTodo);
  await page.keyboard.press("Enter");
  await expect(page.getByText(secondTodo)).toBeVisible();

  await page.getByRole("heading", { name: groupName, exact: true }).click();
  await page.keyboard.press("/");
  await expect(page.getByRole("heading", { name: "Search", exact: true })).toBeVisible();
  await expect(page.locator("[data-search-input='true']")).toBeFocused();
  await page.locator("[data-search-input='true']").fill(firstTodo);
  await expect(page.getByText(firstTodo)).toBeVisible();

  await page.getByRole("button", { name: "Agenda" }).click();
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(page.getByText(firstTodo)).toBeVisible();

  await page.getByRole("button", { name: "Connections" }).click();
  await page.getByRole("button", { name: /New Connection/i }).click();
  await page.getByRole("button", { name: groupName }).click();
  await page.getByRole("button", { name: /Sequence/i }).click();
  await page.getByRole("button", { name: /Dependency/i }).click();
  await page.getByRole("button", { name: new RegExp(firstTodo) }).click();
  await page.getByRole("button", { name: new RegExp(secondTodo) }).click();
  await page.getByRole("button", { name: /Create Connection/i }).click();

  await expect(page.getByText("Dependency")).toBeVisible();
  await expect(page.getByText(firstTodo)).toBeVisible();
});
