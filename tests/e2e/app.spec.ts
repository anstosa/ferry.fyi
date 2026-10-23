import { expect, test } from "@playwright/test";

test("serves the application shell", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "commit" });

  expect(response?.ok()).toBe(true);
  await expect(page.locator("#root")).toBeAttached();
  // prove the client rendered beyond the empty application mount
  await expect(
    page.getByRole("heading", { level: 1, name: "Ferry FYI" })
  ).toBeVisible({ timeout: 20_000 });
});
