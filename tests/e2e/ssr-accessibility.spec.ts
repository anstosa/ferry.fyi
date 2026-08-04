import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const criticalPages = [
  { label: "home", path: "/" },
  { label: "directional schedule", path: "/seattle/bainbridge" },
] as const;

for (const pageCase of criticalPages) {
  test(`@accessibility has no serious automated violations on ${pageCase.label}`, async ({
    page,
  }) => {
    await page.goto(pageCase.path, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ help, id, nodes }) => ({
        help,
        id,
        nodes: nodes.map(({ html, target }) => ({ html, target })),
      }));
    expect(serious).toEqual([]);
  });
}
