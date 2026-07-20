import { expect, test } from "@playwright/test";

test("serves the application shell", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "commit" });

  expect(response?.ok()).toBe(true);
  await expect(page.locator("#root")).toBeAttached();
});
