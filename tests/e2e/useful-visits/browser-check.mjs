import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const directory = path.join(root, "dist/e2e/useful-visits");
const origin = new URL(
  process.env.USEFUL_FIXTURE_URL ?? "http://127.0.0.1:55769"
).origin;
const manifest = JSON.parse(
  await fs.readFile(path.join(directory, ".vite/manifest.json"), "utf8")
);
const allowed = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
]);
// allow only assets generated in this exact fixture build
for (const entry of Object.values(manifest)) {
  allowed.set(`/${entry.file}`, entry.file);
  // include manifest-bound styles and static dependencies
  for (const asset of [...(entry.css ?? []), ...(entry.assets ?? [])])
    allowed.set(`/${asset}`, asset);
}
// classify by exact origin, method, path and configured script id
const classify = (method, rawUrl) => {
  const url = new URL(rawUrl);
  // local assets never permit api or analytics forwarding
  if (method === "GET" && url.origin === origin && allowed.has(url.pathname))
    return "asset";
  // allow only the two exact configured google script resources
  if (
    method === "GET" &&
    url.protocol === "https:" &&
    url.host === "www.googletagmanager.com" &&
    ((url.pathname === "/gtm.js" && url.search === "?id=GTM-USEFUL-FIXTURE") ||
      (url.pathname === "/gtag/js" && url.search === "?id=G-USEFUL-FIXTURE"))
  )
    return "inert-script";
  return "blocked";
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const ledger = [];
const consoleMessages = [];
// never forward any request to a real server or provider
await context.route("**/*", async (route) => {
  const request = route.request();
  const classification = classify(request.method(), request.url());
  ledger.push({
    method: request.method(),
    url: request.url(),
    body: request.postData(),
    classification,
    disposition: classification === "blocked" ? "abort" : "fulfill",
  });
  // fulfill only build-manifest assets from disk
  if (classification === "asset") {
    const file = allowed.get(new URL(request.url()).pathname);
    await route.fulfill({
      body: await fs.readFile(path.join(directory, file)),
      contentType: file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".css")
          ? "text/css"
          : "application/javascript",
    });
    return;
  }
  // inert provider scripts leave real app-owned gtag commands inspectable
  if (classification === "inert-script") {
    await route.fulfill({
      body: "/* isolated provider: no collection */",
      contentType: "application/javascript",
    });
    return;
  }
  await route.abort("blockedbyclient");
});
// retain the browser's real observer while recording only public geometry
await context.addInitScript(() => {
  const NativeObserver = window.IntersectionObserver;
  window.fixtureIntersections = [];
  // preserve native thresholds and callbacks for each exposure regression
  window.IntersectionObserver = class extends NativeObserver {
    // record actual intersection transitions without synthesizing visibility
    constructor(callback, options) {
      super((entries, observer) => {
        // retain only coarse geometry, never nodes or content identity
        for (const entry of entries)
          window.fixtureIntersections.push({
            intersecting: entry.isIntersecting,
            ratio: entry.intersectionRatio,
          });
        callback(entries, observer);
      }, options);
    }
  };
});
const page = await context.newPage();
// capture any renderer errors without printing private inputs
page.on("console", (message) => consoleMessages.push(message.text()));
page.on("pageerror", (error) => consoleMessages.push(error.message));
const clockTime = new Date("2026-10-07T12:00:00Z");
await page.clock.install({ time: clockTime });
await page.clock.pauseAt(clockTime);
// inspect normalized gtag arguments, not a fixture copy of event payloads
const commands = () =>
  page.evaluate(() =>
    (window.dataLayer ?? []).map((entry) =>
      "length" in entry ? Array.from(entry) : entry
    )
  );
const productCommands = async () =>
  (await commands()).filter(
    (entry) =>
      Array.isArray(entry) && entry[0] === "event" && entry[1] !== "page_view"
  );
// await native positive visibility with runner-side polling independent of the paused clock
const waitForPositiveIntersection = async (page, after = 0) => {
  await expect
    .poll(() =>
      page.evaluate(
        (after) =>
          window.fixtureIntersections
            .slice(after)
            .some((entry) => entry.intersecting && entry.ratio > 0),
        after
      )
    )
    .toBe(true);
};
try {
  await page.goto(`${origin}/`);
  await page.locator("section").waitFor();
  // wait for actual intersection observation before advancing the exposure clock
  await waitForPositiveIntersection(page);
  await page.clock.runFor(4999);
  assert.equal((await productCommands()).length, 0);
  await page.clock.runFor(1);
  await page.waitForFunction(() =>
    (window.dataLayer ?? []).some(
      (entry) =>
        "length" in entry && entry[0] === "event" && entry[1] === "useful_visit"
    )
  );
  assert.deepEqual(
    (await productCommands()).map((entry) => entry[1]),
    ["useful_content_view", "useful_visit"]
  );
  // unchanged visible content stays latched despite additional time
  await page.clock.runFor(10000);
  assert.equal((await productCommands()).length, 2);
  const entriesBeforeRemount = await page.evaluate(
    () => window.fixtureIntersections.length
  );
  await page.locator("#toggle").click();
  await page.locator("section").waitFor({ state: "detached" });
  await page.locator("#toggle").click();
  await page.locator("section").waitFor();
  await waitForPositiveIntersection(page, entriesBeforeRemount);
  await page.clock.runFor(5000);
  assert.deepEqual(
    (await productCommands()).map((entry) => entry[1]),
    [
      "useful_content_view",
      "useful_visit",
      "useful_content_view",
      "useful_visit",
    ]
  );
  await page.locator("#rejected").click();
  assert.equal((await productCommands()).length, 4);
  await page.locator("#resolved").click();
  await page.waitForFunction(() =>
    (window.dataLayer ?? []).some(
      (entry) =>
        "length" in entry &&
        entry[0] === "event" &&
        entry[1] === "share_completed"
    )
  );
  const events = await productCommands();
  assert.deepEqual(
    events.slice(-2).map((entry) => entry[1]),
    ["share_completed", "useful_visit"]
  );
  // every app-owned named product call has exact safe route context
  for (const [, name, params] of events) {
    assert.equal(params.page_location, `${origin}/route-a`);
    assert.equal(params.page_referrer, "");
    assert.equal(params.page_title, "Ferry FYI");
    assert.equal(params.send_to, "G-USEFUL-FIXTURE");
    // verify the actual fixed values, not merely their permitted keys
    if (name === "useful_content_view" || name === "share_completed")
      assert.equal(params.surface, "schedule");
    if (name === "share_completed") assert.equal(params.method, "clipboard");
    const extras =
      name === "useful_content_view"
        ? ["surface"]
        : name === "share_completed"
          ? ["surface", "method"]
          : [];
    assert.deepEqual(
      Object.keys(params).sort(),
      [
        "page_location",
        "page_referrer",
        "page_title",
        "send_to",
        ...extras,
      ].sort()
    );
  }
  const data = await commands();
  assert.equal(
    data.filter(
      (entry) => !Array.isArray(entry) && entry.event === "ferry_fyi_event"
    ).length,
    0
  );
  assert.equal(
    data.filter(
      (entry) =>
        Array.isArray(entry) &&
        entry[0] === "config" &&
        entry[2].send_page_view === false
    ).length,
    1
  );
  assert.equal(
    data.filter(
      (entry) =>
        Array.isArray(entry) && entry[0] === "event" && entry[1] === "page_view"
    ).length,
    1
  );
  const config = data.find(
    (entry) => Array.isArray(entry) && entry[0] === "config"
  );
  assert.equal(config[1], "G-USEFUL-FIXTURE");
  assert.equal(config[2].page_location, `${origin}/route-a`);
  assert.equal(config[2].page_referrer, "");
  assert.equal(config[2].page_title, "Ferry FYI");
  assert.equal(config[2].send_to, "G-USEFUL-FIXTURE");
  const pageview = data.find(
    (entry) =>
      Array.isArray(entry) && entry[0] === "event" && entry[1] === "page_view"
  );
  assert.deepEqual(pageview[2], {
    page_path: "/route-a",
    page_location: `${origin}/route-a`,
    page_referrer: "",
    page_title: "Ferry FYI",
    send_to: "G-USEFUL-FIXTURE",
  });
  assert.deepEqual(consoleMessages, []);
  // production-mode explicit pageviews are separate from suppressed config pageviews
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  assert(
    !JSON.stringify([data, ledger, consoleMessages, storage]).includes("UV_")
  );
  // wrong host, method and path must fail closed in both classifier and live routing
  const probes = [
    ["POST", `${origin}/index.html`],
    ["GET", `${origin}/api/unexpected`],
    ["GET", `${origin}/g/collect`],
    ["GET", "https://www.googletagmanager.com/unexpected?id=G-USEFUL-FIXTURE"],
    ["POST", "https://www.googletagmanager.com/gtag/js?id=G-USEFUL-FIXTURE"],
    ["GET", "https://example.invalid/gtag/js?id=G-USEFUL-FIXTURE"],
  ];
  // send synthetic probes only after recording privacy evidence
  for (const [method, url] of probes) {
    assert.equal(classify(method, url), "blocked");
    await page.evaluate(
      async ({ method, url }) => {
        try {
          await fetch(url, { method });
        } catch {
          /* expected rejection */
        }
      },
      { method, url }
    );
    assert(
      ledger.some(
        (entry) =>
          entry.method === method &&
          entry.url === url &&
          entry.classification === "blocked"
      )
    );
  }
  const edgePage = await context.newPage();
  await edgePage.clock.install({ time: clockTime });
  await edgePage.clock.pauseAt(clockTime);
  await edgePage.goto(`${origin}/?boundary`);
  await edgePage.locator("section").waitFor();
  // poll from the runner so the paused exposure clock cannot stall synchronization
  await expect
    .poll(() =>
      edgePage.evaluate(() =>
        window.fixtureIntersections.some(
          (entry) => entry.intersecting && entry.ratio === 0
        )
      )
    )
    .toBe(true);
  const edgeInitial = await edgePage.evaluate(
    () => window.fixtureIntersections
  );
  assert(edgeInitial.some((entry) => entry.intersecting && entry.ratio === 0));
  // inspect only app-owned named product commands from this separate document
  const edgeProducts = () =>
    edgePage.evaluate(() =>
      (window.dataLayer ?? [])
        .filter(
          (entry) =>
            "length" in entry &&
            entry[0] === "event" &&
            entry[1] !== "page_view"
        )
        .map((entry) => entry[1])
    );
  await edgePage.clock.runFor(5000);
  assert.deepEqual(await edgeProducts(), []);
  await edgePage.evaluate(() => window.scrollTo(0, 100));
  // wait for actual positive native visibility rather than elapsed wall time
  await waitForPositiveIntersection(edgePage);
  const edgeAfterScroll = await edgePage.evaluate(
    () => window.fixtureIntersections
  );
  assert(
    edgeAfterScroll.some((entry) => entry.intersecting && entry.ratio > 0),
    "a zero-area entry must notify when actual visible area becomes positive"
  );
  await edgePage.clock.runFor(4999);
  assert.deepEqual(await edgeProducts(), []);
  await edgePage.clock.runFor(1);
  await edgePage.waitForFunction(() =>
    (window.dataLayer ?? []).some(
      (entry) =>
        "length" in entry && entry[0] === "event" && entry[1] === "useful_visit"
    )
  );
  assert.deepEqual(await edgeProducts(), [
    "useful_content_view",
    "useful_visit",
  ]);
  const edgeData = await edgePage.evaluate(() =>
    (window.dataLayer ?? []).map((entry) =>
      "length" in entry ? Array.from(entry) : entry
    )
  );
  assert(!JSON.stringify(edgeData).includes("UV_"));
  await edgePage.close();
  assert(
    ledger.every(
      (entry) =>
        entry.disposition === "fulfill" || entry.disposition === "abort"
    )
  );
  assert(
    !JSON.stringify([await commands(), ledger, consoleMessages]).includes("UV_")
  );
  await page.screenshot({ path: path.join(directory, "verified.png") });
  console.log(
    JSON.stringify({
      result: "passed",
      productEvents: events.map((entry) => entry[1]),
      viewportEdgeTransition: "passed",
      requests: ledger.length,
      externalForwarded: ledger.filter(
        (entry) => entry.disposition === "continue"
      ).length,
      screenshot: "dist/e2e/useful-visits/verified.png",
    })
  );
} finally {
  await context.close();
  await browser.close();
}
