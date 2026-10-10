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
    liveButtonName: /^Confirmed capacity: 25% full Scheduled departure /,
    path: "/seattle/bainbridge",
    ssrText: /76 vehicle spaces reported/,
  },
] as const;
const fixtureOrigin = "https://127.0.0.1:4177";
const fixtureHeaders = { Host: "ferry.fyi" };

// keep the hard-error recovery page accessible after hydration
test("@accessibility has no serious violations on the not-found page", async ({
  page,
}) => {
  const response = await page.goto("/not-a-ferry-page", {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(404);
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  await expect(
    page.getByRole("link", { name: "Find a ferry schedule" })
  ).toBeVisible();
  // retain visible keyboard focus on every recovery action
  for (const name of [
    "Ferry FYI home",
    "Find a ferry schedule",
    "Seattle–Bainbridge",
    "Edmonds–Kingston",
    "Mukilteo–Clinton",
    "Contact Ferry FYI support",
  ]) {
    await page.keyboard.press("Tab");
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await expect(link).toHaveCSS("outline-width", "2px");
    await expect(link).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
  }
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "critical" || impact === "serious"
    )
  ).toEqual([]);
});

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
    // confirmed past capacity stays accessible in the compact collapsed row
    if ("liveButtonName" in pageCase) {
      await expect(
        page.getByRole("button", { name: pageCase.liveButtonName }).first()
      ).toBeVisible();
    } else {
      await expect(
        page.getByText(pageCase.liveText, { exact: true }).first()
      ).toBeVisible();
    }
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
