/* global URL, console, document, process, window */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.SAILING_FIXTURE_URL ?? "http://127.0.0.1:55768/";
const evidenceDirectory = path.resolve(
  process.env.SAILING_EVIDENCE_DIRECTORY ??
    ".omx/evidence/sailing-results-browser"
);
const results = [];

// run one isolated browser scenario with console and network capture
const runScenario = async (browser, options, exercise) => {
  const context = await browser.newContext({
    colorScheme: options.colorScheme ?? "light",
    viewport: options.viewport,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const consoleErrors = [];
  const requests = [];
  // retain only browser errors for the acceptance report
  page.on("console", (message) => {
    // record actionable console output
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  // record request method and host without request bodies
  page.on("request", (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });
  const url = new URL(baseUrl);
  url.searchParams.set("scenario", options.scenario);
  // activate the production class-based dark theme when requested
  if (options.colorScheme === "dark") {
    url.searchParams.set("theme", "dark");
  }
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "What boat will I make?" }).waitFor();
  const initialAudit = await page.evaluate(() => window.__sailingFixture);
  assert.equal(initialAudit.apiCalls, 0);
  assert.equal(initialAudit.locationRequests, 0);
  await exercise(page);
  await page.screenshot({
    fullPage: true,
    path: path.join(evidenceDirectory, `${options.name}.png`),
  });
  const finalAudit = await page.evaluate(() => window.__sailingFixture);
  const storage = await page.evaluate(() => ({ ...window.localStorage }));
  const currentUrl = page.url();
  const body = await page.locator("body").innerText();
  const externalRequests = requests.filter(
    (request) => new URL(request.url).origin !== new URL(baseUrl).origin
  );
  const postRequests = requests.filter((request) => request.method === "POST");
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(postRequests, []);
  results.push({
    body,
    consoleErrors,
    currentUrl,
    finalAudit,
    initialAudit,
    name: options.name,
    postRequests,
    requestCount: requests.length,
    storage,
    viewport: options.viewport,
  });
  await context.close();
};

// submit one fixture route through the production foreground-location control
const requestEstimate = async (page) => {
  await page.getByRole("button", { name: "Use my location" }).click();
  await page.getByText("Estimated terminal arrival", { exact: true }).waitFor();
};

// resolve the prominent arrival time within its dedicated result block
const arrivalTime = (page) =>
  page
    .getByText("Estimated terminal arrival", { exact: true })
    .locator("..")
    .locator("p")
    .nth(1);

// require the three chronological result columns and their names
const assertSailingTrio = async (page, names) => {
  const grid = page.getByLabel("Sailing estimates");
  assert.equal(await grid.locator(":scope > div").count(), 3);
  await grid.getByText("Earlier", { exact: true }).waitFor();
  await grid.getByText("Estimated", { exact: true }).waitFor();
  await grid.getByText("Later", { exact: true }).waitFor();
  // match the chance colors and collapsed chevrons in each column
  for (const column of await grid.locator(":scope > div").all()) {
    const chance = column.getByRole("button");
    const percent = parseFloat((await chance.innerText()).replace(/[<>]/g, ""));
    const color =
      percent <= 30
        ? "text-red-700"
        : percent < 70
          ? "text-orange-700"
          : "text-green-dark";
    assert.match(
      await column.locator("p").nth(1).getAttribute("class"),
      new RegExp(color)
    );
    assert.match(await chance.getAttribute("class"), new RegExp(color));
    assert.equal(await chance.locator('svg[data-direction="down"]').count(), 1);
  }
  // prove each requested chronological context is rendered
  for (const name of names) {
    await grid.getByText(name, { exact: true }).waitFor();
  }
};

await fs.rm(evidenceDirectory, { force: true, recursive: true });
await fs.mkdir(evidenceDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  // prove the complete drive result, details, attribution and buffer reselection
  await runScenario(
    browser,
    {
      name: "success-desktop-light",
      scenario: "success",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await requestEstimate(page);
      assert.match(
        await arrivalTime(page).getAttribute("class"),
        /text-green-dark/
      );
      await page.getByText("Light traffic", { exact: true }).waitFor();
      await assertSailingTrio(page, [
        "MV Earlier Fixture",
        "MV Estimated Fixture",
        "MV Later Fixture",
      ]);
      assert.equal(await page.getByText(/Tight timing:/).count(), 0);
      const chance = page.getByRole("button", {
        name: /^Estimated:/,
      });
      await chance.click();
      assert.equal(await chance.getAttribute("aria-expanded"), "true");
      await page.getByText("Planning arrival range", { exact: true }).waitFor();
      await page
        .locator("#sailing-chance-details")
        .getByText("Safety buffer", { exact: true })
        .waitFor();
      await page.getByText("Arrival + buffer", { exact: true }).waitFor();
      await page
        .getByText("Estimated drive-up spaces at arrival", { exact: true })
        .waitFor();
      await page
        .getByText("Modeled spaces across arrival range", { exact: true })
        .waitFor();
      await page.getByText("Planning fill range", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByText(/Planning ranges use assumed triangular distributions/)
          .count(),
        0
      );
      assert.equal(await chance.locator('svg[data-direction="up"]').count(), 1);
      assert.equal(
        await page.getByText("Estimated chance", { exact: true }).count(),
        0
      );
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        1
      );
      await page.getByLabel("Safety buffer (minutes)").fill("21");
      await page
        .getByLabel("Sailing estimates")
        .getByText("MV Later Fixture", { exact: true })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.__sailingFixture)).apiCalls,
        1
      );
      const resultCard = page.locator(
        "section[aria-labelledby='sailing-recommendation-title']"
      );
      assert.equal(await resultCard.getByText(/Google Maps/).count(), 0);
      const attribution = resultCard.locator("+ p[translate='no']");
      assert.match(
        await attribution.innerText(),
        /^Google Maps · ©\d{4} Google$/
      );
      assert.match(await attribution.getAttribute("class"), /text-xs/);
      assert.doesNotMatch(
        await attribution.locator("..").getAttribute("class"),
        /bg-white|rounded-2xl/
      );
    }
  );

  // prove the compact three-column result is bounded on a mobile viewport
  await runScenario(
    browser,
    {
      name: "success-mobile-light",
      scenario: "success",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      await assertSailingTrio(page, [
        "MV Earlier Fixture",
        "MV Estimated Fixture",
        "MV Later Fixture",
      ]);
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        ),
        true
      );
      const buttons = page
        .getByLabel("Sailing estimates")
        .getByRole("button", { name: /^(Earlier|Estimated|Later):/ });
      assert.equal(await buttons.count(), 3);
      await buttons.nth(0).click();
      await page.getByText(/sailing details ·/).waitFor();
    }
  );

  // prove the app-defined moderate arrival color and label
  await runScenario(
    browser,
    {
      name: "moderate-mobile-light",
      scenario: "moderate",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      assert.match(
        await arrivalTime(page).getAttribute("class"),
        /text-amber-700/
      );
      await page.getByText("Moderate traffic", { exact: true }).waitFor();
    }
  );

  // prove the heavy arrival color and dark palette together
  await runScenario(
    browser,
    {
      colorScheme: "dark",
      name: "heavy-mobile-dark",
      scenario: "heavy",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      assert.equal(await page.locator("html.dark").count(), 1);
      assert.match(
        await arrivalTime(page).getAttribute("class"),
        /text-red-700/
      );
      await page.getByText("Heavy traffic", { exact: true }).waitFor();
      await page
        .getByRole("button", {
          name: /^Estimated:/,
        })
        .click();
      await page
        .getByText("Estimated traffic delay", { exact: true })
        .waitFor();
    }
  );

  // prove missing traffic data stays neutral rather than implying light traffic
  await runScenario(
    browser,
    {
      name: "traffic-unavailable-desktop",
      scenario: "traffic-unavailable",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await requestEstimate(page);
      await page.getByText("Traffic unavailable", { exact: true }).waitFor();
      const classes = await arrivalTime(page).getAttribute("class");
      assert.doesNotMatch(classes, /text-(green|amber|red)/);
    }
  );

  // prove unknown vehicle inventory is not presented as a zero chance
  await runScenario(
    browser,
    {
      name: "capacity-unavailable-mobile",
      scenario: "capacity-unavailable",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      const center = page
        .getByLabel("Sailing estimates")
        .locator(":scope > div")
        .nth(1);
      await center.getByText("Unknown", { exact: true }).waitFor();
      assert.match(
        await center.getByRole("button").getAttribute("class"),
        /text-gray-dark/
      );
      await center.getByRole("button").click();
      await page
        .getByText(/Drive-up availability could not be estimated/)
        .waitFor();
    }
  );

  // prove a direct observed zero is presented as a hard zero
  await runScenario(
    browser,
    {
      name: "vehicle-full-mobile",
      scenario: "vehicle-full",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      const center = page
        .getByLabel("Sailing estimates")
        .locator(":scope > div")
        .nth(1);
      await center.getByText("0%", { exact: true }).waitFor();
      await center.getByRole("button").click();
      await page.getByText("WSF reported zero drive-up spaces.").waitFor();
    }
  );

  // prove the retired tight-timing warning remains absent for a tight outcome
  await runScenario(
    browser,
    {
      name: "tight-timing-mobile",
      scenario: "tight-timing",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await requestEstimate(page);
      await page.getByText("Estimated", { exact: true }).waitFor();
      assert.equal(await page.getByText(/Tight timing:/).count(), 0);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /WSF advises arriving/i
      );
    }
  );

  // prove a denied foreground request recovers through an ephemeral manual origin
  await runScenario(
    browser,
    {
      name: "denied-manual-mobile",
      scenario: "denied",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page
        .getByText("Location is unavailable. Enter an address instead.")
        .waitFor();
      const address = "123 Browser Privacy Lane, Edmonds, WA";
      await page.getByLabel("Starting address").fill(address);
      await page.getByRole("button", { name: "Estimate trip" }).click();
      await page
        .getByText("Estimated terminal arrival", { exact: true })
        .waitFor();
      assert.equal(await page.getByLabel("Starting address").inputValue(), "");
      assert.doesNotMatch(page.url(), /Browser|Privacy|Edmonds/i);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /Browser Privacy/
      );
    }
  );

  // prove a schedule revision race suppresses the returned estimate
  await runScenario(
    browser,
    {
      name: "stale-desktop",
      scenario: "stale",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page
        .getByText(/estimate expired or the schedule changed/i)
        .waitFor();
      assert.equal(
        await page
          .getByText("Estimated terminal arrival", { exact: true })
          .count(),
        0
      );
    }
  );

  // prove quota failure stays contained within the card
  await runScenario(
    browser,
    {
      name: "provider-error-desktop",
      scenario: "provider-error",
      viewport: { height: 900, width: 1280 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page
        .getByText("Travel estimates are busy. Try again shortly.")
        .waitFor();
      await page.getByText("Today's sailings").waitFor();
    }
  );

  // prove ferry recursion produces its distinct copy and warning
  await runScenario(
    browser,
    {
      colorScheme: "dark",
      name: "recursion-dark-mobile",
      scenario: "recursion",
      viewport: { height: 812, width: 375 },
    },
    async (page) => {
      await page.getByRole("button", { name: "Use my location" }).click();
      await page.getByText(/available route includes ferry travel/i).waitFor();
      await page
        .getByText("Ferry travel is excluded from the route to the terminal.")
        .waitFor();
      await page.keyboard.press("Tab");
      assert.notEqual(
        await page.evaluate(() => document.activeElement?.tagName ?? ""),
        "BODY"
      );
    }
  );
} finally {
  await browser.close();
}

await fs.writeFile(
  path.join(evidenceDirectory, "report.json"),
  `${JSON.stringify({ baseUrl, results }, null, 2)}\n`
);
console.log(
  JSON.stringify(
    {
      evidenceDirectory,
      passed: results.map((result) => result.name),
      scenarioCount: results.length,
    },
    null,
    2
  )
);
