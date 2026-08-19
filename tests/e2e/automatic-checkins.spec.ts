import { expect, test } from "@playwright/test";

// target one production-component fixture
const fixtureUrl = "/__automatic__/index.html";

// verify the web install banner and persisted dismissal
test("@automatic-checkins advertises the native app only when the automatic flag is enabled", async ({
  page,
}) => {
  await page.goto(`${fixtureUrl}?scenario=web-banner`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  const banner = page.getByText("Automatic background check-ins");
  await expect(banner).toBeVisible();
  await expect(page.getByText(/even when the app is not open/u)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Install the app" })
  ).toHaveAttribute("href", "/install");

  await page.locator(".alert__close").click();
  await expect(banner).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(banner).toHaveCount(0);

  await page.goto(`${fixtureUrl}?scenario=feature-off`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Automatic background check-ins")).toHaveCount(0);
});

// verify disclosure, fallback, keyboard, aria, and reduced motion
test("@automatic-checkins exercises disclosure, status, manual fallback, and accessibility", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });

  const section = page.locator(
    'section[aria-labelledby="automatic-checkins-title"]'
  );
  await expect(section).toBeVisible();
  await expect(section).toContainText("short-lived encrypted");
  await expect(section.getByRole("status")).toContainText("active");
  await expect(
    page.getByRole("link", { name: "Manual terminal check-in" })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manual vessel check-in" })
  ).toBeVisible();

  const consent = section.getByRole("checkbox");
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await expect(
    section.getByRole("button", { name: "Enable automatic check-ins" })
  ).toBeEnabled();
  expect(
    // inspect one focused control
    await consent.evaluate((element) => document.activeElement === element)
  ).toBe(true);
  expect(
    // inspect reduced-motion output
    await section.evaluate(
      (element) => getComputedStyle(element).animationDuration
    )
  ).not.toMatch(/^[1-9]\d*(?:\.\d+)?s$/u);
});

// verify payload-free refetch and both recovery actions
test("@automatic-checkins keeps invalidation detail-free and exposes recovery actions", async ({
  page,
}) => {
  await page.goto(`${fixtureUrl}?scenario=degraded`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByText("Background monitoring is unavailable")
  ).toBeVisible();
  await page.getByRole("button", { name: "Review device settings" }).click();
  // wait for one reviewed settings action
  await expect
    .poll(
      async () =>
        await page.evaluate(
          // read one aggregate fixture call list
          () => window.automaticCheckinFixture.read().calls
        )
    )
    .toContain("native:settings");

  // replace aggregate state before emitting an empty event
  await page.evaluate(
    // replace aggregate state before one empty event
    () => {
      const current = window.automaticCheckinFixture.read();
      window.automaticCheckinFixture.set({
        status: {
          ...current.status,
          lastOutcome: "cleanup_required",
          monitorHealth: "force_stopped",
          pendingCandidateCount: 2,
        },
      });
      window.automaticCheckinFixture.emitChange();
    }
  );
  await expect(page.getByText(/after force-stopping/u)).toBeVisible();
  await expect(page.locator("main")).not.toContainText("terminal-7");
  const calls = await page.evaluate(
    // read one aggregate fixture call list
    () => window.automaticCheckinFixture.read().calls
  );
  expect(calls).toContain("native:event");
  // count only aggregate native reads
  const statusReadCount = calls.filter(
    (call) => call === "native:status"
  ).length;
  expect(statusReadCount).toBeGreaterThan(1);
});

// verify controllable cleanup ordering through the production component
test("@automatic-checkins purges locally before server disable and keeps manual actions", async ({
  page,
}) => {
  await page.goto(`${fixtureUrl}?scenario=enabled`, {
    waitUntil: "domcontentloaded",
  });
  // isolate the controllable disable sequence from initial reads
  await page.evaluate(
    // reset one fixture call list
    () => window.automaticCheckinFixture.set({ calls: [] })
  );
  await page
    .getByRole("button", { name: "Disable automatic check-ins" })
    .click();
  await expect(
    page.getByText("I understand the background-location use")
  ).toBeVisible();

  const calls = await page.evaluate(
    // read one aggregate fixture call list
    () => window.automaticCheckinFixture.read().calls
  );
  expect(calls.indexOf("native:purge")).toBeGreaterThanOrEqual(0);
  expect(calls.indexOf("native:purge")).toBeLessThan(
    calls.indexOf("auth:token")
  );
  expect(calls.indexOf("auth:token")).toBeLessThan(
    calls.indexOf("api:POST:/api/leaderboards/automatic/disable")
  );
  await expect(
    page.getByRole("link", { name: "Use manual check-in" })
  ).toBeVisible();
});

// verify denied, default-off, and unsupported production copy
test("@automatic-checkins reports denied, degraded, and unavailable native states", async ({
  page,
}) => {
  await page.goto(`${fixtureUrl}?scenario=denied`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Allow precise location")).toBeVisible();
  await page.getByRole("button", { name: "Review device settings" }).click();
  // wait for one foreground permission action
  await expect
    .poll(
      async () =>
        await page.evaluate(
          // read one aggregate fixture call list
          () => window.automaticCheckinFixture.read().calls
        )
    )
    .toContain("native:foreground-permission");

  await page.goto(`${fixtureUrl}?scenario=disabled`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("unavailable in this app build")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Automatic leaderboard check-ins" })
  ).toHaveCount(0);

  await page.goto(`${fixtureUrl}?scenario=unsupported`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Android 10 or newer")).toBeVisible();
});
