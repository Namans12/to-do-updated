import { expect, test } from "@playwright/test";

async function dismissReminderAlarm(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stopButton = page.getByRole("button", { name: "Stop" });
    if (!(await stopButton.isVisible().catch(() => false))) break;
    await stopButton.click();
    await page.waitForTimeout(150);
  }
}

test("main app flow covers shortcuts, reminders, and connection meaning", async ({ page }) => {
  const unique = Date.now();
  const groupName = `E2E Group ${unique}`;
  const secondGroupName = `Second Group ${unique}`;
  const firstTodo = `Plan launch ${unique}`;
  const secondTodo = `Ship checklist ${unique}`;
  const reminderDate = new Date(Date.now() + 86_400_000);
  const yyyy = reminderDate.getFullYear();
  const mm = String(reminderDate.getMonth() + 1).padStart(2, "0");
  const dd = String(reminderDate.getDate()).padStart(2, "0");
  const dateValue = `${yyyy}-${mm}-${dd}`;

  await page.goto("/");

  const shortcutDialog = page.getByRole("heading", { name: "Keyboard Shortcuts" });
  if (await shortcutDialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(shortcutDialog).not.toBeVisible();
  }
  await page.request.post("/api/groups", { data: { name: groupName } });
  await page.request.post("/api/groups", { data: { name: secondGroupName } });
  await page.reload();
  await dismissReminderAlarm(page);

  await dismissReminderAlarm(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("switch", { name: /Enable keyboard shortcuts/i }).click();
  await page.keyboard.press("g");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("switch", { name: /Enable keyboard shortcuts/i }).click();
  await page.getByLabel("GraphPlan shortcut").focus();
  await page.keyboard.press("ControlOrMeta+H");
  await page.getByRole("heading", { name: "Settings", exact: true }).click();
  await page.keyboard.press("g");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+H");
  await expect(page.getByText("GraphPlan", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("t");

  await dismissReminderAlarm(page);
  await page.getByText(groupName, { exact: true }).click();
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
  const modal = page.locator(".fixed.inset-0.z-50");
  await modal.getByRole("button", { name: groupName }).click();
  await modal.getByRole("button", { name: secondGroupName }).click();
  await expect(page.getByText("No more tasks in this group.")).toBeVisible();
  await modal.getByRole("button", { name: groupName }).click();
  await page.getByRole("button", { name: /Sequence/i }).click();
  await page.getByRole("button", { name: /Dependency/i }).click();
  await page.getByRole("button", { name: new RegExp(firstTodo) }).click();
  await page.getByRole("button", { name: new RegExp(secondTodo) }).click();
  await page.getByRole("button", { name: /Create Connection/i }).click();

  await expect(page.getByText("Dependency").first()).toBeVisible();
  await expect(page.getByText(firstTodo)).toBeVisible();
});
