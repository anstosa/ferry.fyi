import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const criticalPages = [
  {
    label: "home",
    liveText: "Seattle refreshed",
    path: "/",
    ssrText: "Seattle",
  },
  {
    label: "directional schedule",
    liveText: "75 spaces left",
    path: "/seattle/bainbridge",
    ssrText: /76 vehicle spaces reported/,
  },
] as const;
const fixtureOrigin = "https://127.0.0.1:4177";
const fixtureHeaders = { Host: "ferry.fyi" };

// scan critical hydrated pages
for (const pageCase of criticalPages) {
  // verify one hydrated page
  test(`@accessibility has no serious automated violations on ${pageCase.label}`, async ({
    page,
    request,
  }) => {
    const pageErrors: string[] = [];
    // capture client startup failures
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const reset = await request.post(`${fixtureOrigin}/__fixture__/reset`, {
      data: {},
      headers: fixtureHeaders,
    });
    expect(reset.ok()).toBe(true);
    const { promise: browserPhaseGate, resolve: releaseBrowserPhase } =
      Promise.withResolvers<void>();
    // hold the live browser phase
    await page.route("**/assets/browserApp.*.js", async (route) => {
      await browserPhaseGate;
      await route.continue();
    });
    const response = await page.goto(pageCase.path, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await expect(page.getByText(pageCase.ssrText).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
    const control = await request.post(`${fixtureOrigin}/__fixture__/control`, {
      data: { refreshVersion: 2 },
      headers: fixtureHeaders,
    });
    expect(control.ok()).toBe(true);
    releaseBrowserPhase();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(pageCase.liveText, { exact: true }).first()
    ).toBeVisible();
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
    expect(pageErrors).toEqual([]);
  });
}
