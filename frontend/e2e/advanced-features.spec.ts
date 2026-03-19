import { expect, test } from "@playwright/test";

async function dismissReminderAlarm(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stopButton = page.getByRole("button", { name: "Stop" });
    if (!(await stopButton.isVisible().catch(() => false))) break;
    await stopButton.click();
    await page.waitForTimeout(150);
  }
}

test("templates, task history, and graph quick add work together", async ({ page }) => {
  const unique = Date.now();
  const sourceGroupName = `Template Source ${unique}`;
  const targetGroupName = `Template Target ${unique}`;
  const todoTitle = `Template Task ${unique}`;
  const updatedTodoTitle = `${todoTitle} Updated`;
  const templateName = `Weekly Board ${unique}`;

  const sourceGroupRes = await page.request.post("/api/groups", { data: { name: sourceGroupName } });
  const sourceGroup = await sourceGroupRes.json();
  const targetGroupRes = await page.request.post("/api/groups", { data: { name: targetGroupName } });
  const targetGroup = await targetGroupRes.json();
  await page.request.post(`/api/groups/${sourceGroup.data.id}/todos`, {
    data: { title: todoTitle, planning_level: 2, recurrence_rule: "weekly" },
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("nodes-todo-shortcuts-seen", "true");
  });
  await page.goto("/");
  await dismissReminderAlarm(page);

  await dismissReminderAlarm(page);
  await page.getByText(sourceGroupName, { exact: true }).click();
  await expect(page.getByRole("heading", { name: sourceGroupName, exact: true })).toBeVisible();

  await dismissReminderAlarm(page);
  await page.getByRole("button", { name: `Edit ${todoTitle}` }).click();
  await page.locator(`input[value="${todoTitle}"]`).fill(updatedTodoTitle);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(updatedTodoTitle, { exact: true }).first()).toBeVisible();

  await page.locator(`[aria-label="View history for ${updatedTodoTitle}"]`).click({ force: true });
  await expect(page.getByRole("heading", { name: "Task History" })).toBeVisible();
  await expect(page.getByText(updatedTodoTitle, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Title", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(todoTitle, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(updatedTodoTitle, { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await dismissReminderAlarm(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Template name").fill(templateName);
  await page.getByLabel("Template description").fill("Reusable weekly planning board");
  await page.getByRole("button", { name: "Save Template" }).click();
  await expect(page.getByText(templateName, { exact: true })).toBeVisible();

  await dismissReminderAlarm(page);
  await page.getByText(targetGroupName, { exact: true }).click();
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "Apply" }).first().click();
  await page.keyboard.press("t");
  await expect(page.getByText(updatedTodoTitle, { exact: true })).toBeVisible();

  await dismissReminderAlarm(page);
  await page.keyboard.press("g");
  await page.getByLabel("Quick add task").click();
  await expect(page.getByText("GraphPlan Task", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Task title").fill("New graph task");
  await page.keyboard.press("Enter");
  await expect(page.getByText("GraphPlan Task", { exact: true })).toHaveCount(0);
  await expect(page.getByText("New graph task", { exact: true }).first()).toBeVisible();

  const graphTodoCard = page
    .locator("[data-todo-id]")
    .filter({ hasText: "New graph task" })
    .first();
  await graphTodoCard.getByTitle("Toggle completion").click();

  const todosAfterToggleRes = await page.request.get(`/api/groups/${targetGroup.data.id}/todos`);
  const todosAfterToggleJson = await todosAfterToggleRes.json();
  const graphTodo = todosAfterToggleJson.data.find(
    (todo: { title: string; is_completed: number }) => todo.title === "New graph task"
  );
  expect(graphTodo?.is_completed).toBe(1);
});
