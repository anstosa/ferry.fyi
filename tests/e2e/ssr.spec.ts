import fs from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";
import { JSDOM } from "jsdom";

const privateCanary = "private-canary-must-never-cross";
const fixtureCertificate = fs.readFileSync(
  path.resolve(process.cwd(), "tests/e2e/certs/ferry-fyi.crt")
);

const fixture = async (
  path: string,
  body?: Record<string, unknown>,
  port = 4177
): Promise<{ json(): unknown }> => {
  const responseBody = await new Promise<string>((resolve, reject) => {
    const request = https.request(
      {
        headers: {
          "Content-Type": "application/json",
          Host: "ferry.fyi",
        },
        hostname: "127.0.0.1",
        ca: fixtureCertificate,
        method: body ? "POST" : "GET",
        path,
        port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8"))
        );
      }
    );
    request.on("error", reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
  return {
    json() {
      return JSON.parse(responseBody) as unknown;
    },
  };
};

type FixtureState = {
  fills: number;
  requests: number;
  telemetry: unknown[];
};

const fixtureState = async (port = 4177): Promise<FixtureState> => {
  const response = await fixture("/__fixture__/state", undefined, port);
  return (await response.json()) as FixtureState;
};

const raw = async (
  path: string,
  options: {
    authenticated?: boolean;
    headers?: Record<string, string>;
    host?: "ferry.fyi" | "howmanyboats.today";
    port?: 4177 | 4178 | 4179;
    redirect?: RequestRedirect;
  } = {}
): Promise<{
  body: string;
  response: {
    headers: { get(name: string): string | null };
    status: number;
  };
}> => {
  const authenticated = options.authenticated !== false;
  const result = await new Promise<{
    body: string;
    headers: IncomingHttpHeaders;
    status: number;
  }>((resolve, reject) => {
    const request = https.request(
      {
        headers: {
          ...(authenticated
            ? {
                Authorization: `Bearer ${privateCanary}`,
                Cookie: `session=${privateCanary}`,
                "User-Agent": privateCanary,
              }
            : {}),
          Host: options.host ?? "ferry.fyi",
          ...options.headers,
        },
        hostname: "127.0.0.1",
        ca: fixtureCertificate,
        method: "GET",
        path,
        port: options.port ?? 4177,
        // fixture certificate identity
        servername: "ferry.fyi",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          })
        );
      }
    );
    request.on("error", reject);
    request.end();
  });
  if (
    options.redirect !== "manual" &&
    result.status >= 300 &&
    result.status < 400 &&
    typeof result.headers.location === "string"
  ) {
    return raw(result.headers.location, options);
  }
  return {
    body: result.body,
    response: {
      headers: {
        get(name) {
          const value = result.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(", ") : (value ?? null);
        },
      },
      status: result.status,
    },
  };
};

const expectDocumentHeaders = (response: {
  headers: { get(name: string): string | null };
}) => {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("surrogate-control")).toBe("no-store");
  expect(response.headers.get("vary")).toContain("Host");
};

// check metadata placement and image alternatives before JavaScript runs
const expectDescriptionAndImageAlt = (html: string): void => {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const descriptions = document.head.querySelectorAll(
    'meta[name="description"]'
  );
  expect(descriptions).toHaveLength(1);
  expect(descriptions[0]?.getAttribute("content")?.trim()).toBeTruthy();
  expect(
    document.body.querySelectorAll('meta[name="description"]')
  ).toHaveLength(0);
  expect(document.querySelectorAll("img:not([alt])")).toHaveLength(0);
  dom.window.close();
};

// retain exactly one description and image alternatives after browser updates
const expectHydratedDescriptionAndImageAlt = async (
  page: Page
): Promise<void> => {
  const description = page.locator('head meta[name="description"]');
  await expect(description).toHaveCount(1);
  await expect(description).toHaveAttribute("content", /\S/);
  await expect(page.locator('body meta[name="description"]')).toHaveCount(0);
  await expect(page.locator("img:not([alt])")).toHaveCount(0);
};

const installRootSentinel = async (page: Page) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const root = document.querySelector("#root");
      const meaningful = root?.querySelector("a");
      if (root && meaningful) {
        const fixtureWindow = window as Window & {
          __fixtureInitialMeaningful?: Element;
          __fixtureInitialRoot?: Element;
        };
        fixtureWindow.__fixtureInitialRoot = root;
        fixtureWindow.__fixtureInitialMeaningful = meaningful;
        (meaningful as HTMLElement).focus();
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
};

test.beforeEach(async () => {
  await fixture("/__fixture__/reset", {});
});

test("keeps initial SSR content visible without an entrance animation", async ({
  page,
}) => {
  const clientStartup = page.waitForRequest(
    /\/assets\/entry-client\.[^/]+\.js$/,
    { timeout: 3_000 }
  );
  const response = await page.goto("https://ferry.fyi:4177/", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  await clientStartup;
  const main = page.locator("#root main").first();
  await expect(main).toContainText("Ferry FYI");
  await expect(
    page.getByRole("navigation", { name: "Ferry terminals" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bainbridge Island" })
  ).toBeVisible();

  const initialStyle = await main.evaluate((element) => {
    const entranceAnimation = element
      .getAnimations()
      .find(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.animationName === "app-content-enter"
      );
    const style = getComputedStyle(element);
    return {
      display: style.display,
      hasEntranceAnimation: Boolean(entranceAnimation),
      opacity: style.opacity,
      transform: style.transform,
      visibility: style.visibility,
    };
  });

  expect(initialStyle).toMatchObject({
    display: "block",
    hasEntranceAnimation: false,
    opacity: "1",
    transform: "none",
    visibility: "visible",
  });
});

test("replays an early in-root button click exactly once after startup", async ({
  page,
}) => {
  await page.route(/\/assets\/entry-client\.[^/]+\.js$/, async (route) => {
    await route.fulfill({
      body: "export const clientReady = new Promise((resolve) => setTimeout(resolve, 50));",
      contentType: "text/javascript",
    });
  });
  await page.goto("https://ferry.fyi:4177/", {
    waitUntil: "load",
  });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "early-action-probe";
    button.textContent = "Early action";
    button.addEventListener("click", () => {
      const browserWindow = window as Window & { earlyActionCount?: number };
      browserWindow.earlyActionCount =
        (browserWindow.earlyActionCount ?? 0) + 1;
    });
    document.querySelector("#root")?.append(button);
  });

  const probe = page.locator("#early-action-probe");
  await probe.dispatchEvent("pointerdown");
  await probe.dispatchEvent("click");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { earlyActionCount?: number }).earlyActionCount ??
          0
      )
    )
    .toBe(1);
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { earlyActionCount?: number }).earlyActionCount ?? 0
    )
  ).toBe(1);
});

// check startup and metadata across public and private routed surfaces
for (const [label, path] of [
  ["home", "/"],
  ["today", "/today"],
  ["tickets", "/tickets"],
  ["account", "/account"],
  ["admin", "/admin"],
  ["leaderboards", "/leaderboards"],
  ["leaderboard settings", "/leaderboards/settings"],
  ["terminal leaderboard", "/leaderboards/terminals/7"],
  ["vessel leaderboard", "/leaderboards/vessels/fixture-vessel"],
  ["about", "/about"],
  ["data sources", "/data-sources"],
  ["privacy", "/privacy"],
  ["forecasting", "/forecasting"],
  ["support", "/support"],
  ["legacy feedback redirect", "/feedback"],
  ["schedule", "/seattle/bainbridge"],
  ["cameras", "/seattle/bainbridge/cameras"],
  ["terminal details", "/seattle/bainbridge/terminal"],
  ["fares", "/seattle/bainbridge/fare"],
  ["map", "/seattle/bainbridge/map"],
  ["alerts", "/seattle/bainbridge/alerts"],
  ["alert subscription", "/seattle/bainbridge/subscribe"],
] as const) {
  test(`loads ${label} without duplicate initial API requests`, async ({
    context,
    page,
  }) => {
    await context.addInitScript(() => {
      navigator.serviceWorker
        ?.getRegistrations()
        .then((registrations) =>
          registrations.forEach((registration) => registration.unregister())
        );
    });
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(`${request.method()} ${url.pathname}${url.search}`);
      }
    });

    const response = await page.goto(`https://ferry.fyi:4177${path}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), `${label} document`).toBe(200);
    expectDescriptionAndImageAlt(await response!.text());
    const root = page.locator("#root");
    await expect(root, `${label} root`).toHaveCount(1);
    // consume the snapshot only when this document provides one
    if (
      (await root.getAttribute("data-ferry-fyi-render-mode")) === "snapshot"
    ) {
      await expect(root, `${label} hydration`).toHaveAttribute(
        "data-ferry-fyi-snapshot-consumed",
        "true"
      );
    }
    await page.waitForLoadState("networkidle");
    const hydratedUrl = new URL(page.url());
    // inspect first-party documents rather than the fixture login error page
    if (hydratedUrl.hostname === "ferry.fyi") {
      await expectHydratedDescriptionAndImageAlt(page);
    } else {
      // only login-gated views may leave for the unavailable fixture Auth0 host
      expect(["/account", "/seattle/bainbridge/subscribe"]).toContain(path);
      expect(hydratedUrl.protocol).toBe("chrome-error:");
    }

    const counts = new Map<string, number>();
    apiRequests.forEach((request) =>
      counts.set(request, (counts.get(request) ?? 0) + 1)
    );
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    expect(duplicates, `${label} duplicate requests`).toEqual([]);
  });
}

for (const [label, url] of [
  ["static About", "https://ferry.fyi:4177/about"],
  ["host-profile Today", "https://howmanyboats.today:4177/"],
] as const) {
  test(`hydrates the built ${label} tree without replacing meaningful nodes`, async ({
    page,
  }) => {
    await installRootSentinel(page);
    const { promise: browserPhaseGate, resolve: releaseBrowserPhase } =
      Promise.withResolvers<void>();
    await page.route("**/assets/browserApp.*.js", async (route) => {
      await browserPhaseGate;
      await route.continue();
    });
    const hydrationDiagnostics: string[] = [];
    const pageErrors: string[] = [];
    const requestedScripts: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (request.resourceType() === "script") {
        requestedScripts.push(request.url());
      }
    });
    page.on("console", (message) => {
      const text = message.text();
      if (
        /client render diagnostic|hydration|react-recoverable-error|did not match|server rendered/i.test(
          text
        )
      ) {
        hydrationDiagnostics.push(text);
      }
    });

    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#root")).toHaveAttribute(
      "data-ferry-fyi-snapshot-consumed",
      "true"
    );
    expect(pageErrors).toEqual([]);
    expect(hydrationDiagnostics).toEqual([]);
    expect(
      await page.evaluate(() => {
        const fixtureWindow = window as Window & {
          __fixtureInitialMeaningful?: Element;
          __fixtureInitialRoot?: Element;
        };
        return {
          meaningful:
            fixtureWindow.__fixtureInitialMeaningful ===
            document.querySelector("#root a"),
          root:
            fixtureWindow.__fixtureInitialRoot ===
            document.querySelector("#root"),
        };
      })
    ).toEqual({ meaningful: true, root: true });

    releaseBrowserPhase();
    await page.waitForLoadState("networkidle");
    if (label === "host-profile Today") {
      await expect(
        page.getByRole("heading", {
          name: "How Many Boats Are There Today?",
        })
      ).toBeVisible();
      await expect(page).toHaveTitle("How Many Boats? - Ferry FYI");
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        "https://howmanyboats.today"
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        "https://howmanyboats.today"
      );
      expect(pageErrors).toEqual([]);
      expect(hydrationDiagnostics).toEqual([]);
      expect(
        requestedScripts.some((url) => /\/assets\/Home\.[^.]+\.js$/.test(url))
      ).toBe(false);
    }
  });
}

// keep terminal metadata available before and after the browser handoff
test("retains one terminal canonical through hydration", async ({ page }) => {
  // compare the same fixture host before and after hydration
  const terminal = await raw("/seattle/terminal", {
    authenticated: false,
    headers: { Host: "ferry.fyi:4177" },
  });
  expect(terminal.response.status).toBe(200);
  const head = terminal.body.split("</head>")[0];
  expect(head.match(/rel="canonical"/g)).toHaveLength(1);
  expect(head).toContain('href="https://ferry.fyi:4177/seattle/terminal"');

  await page.goto("/seattle/terminal", { waitUntil: "networkidle" });
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  await expect(page.locator('head link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://ferry.fyi:4177/seattle/terminal"
  );
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    "index,follow"
  );
});

test("serves page-specific React source from built artifacts", async () => {
  const cases = [
    ["/about", "About Ferry FYI"],
    ["/tickets", "Using your ticket wallet"],
    ["/seattle", "Seattle to Bainbridge Washington State Ferries schedule"],
    ["/seattle/cameras", "Seattle holding area"],
    ["/seattle/fare", "Adult passenger"],
    ["/seattle/map", "Fixture Ferry"],
    ["/seattle/alerts", "Fixture service alert"],
    ["/seattle/subscribe", "Alert subscriptions are personal"],
    ["/seattle/terminal", "Waiting room"],
    ["/leaderboards/terminals/7", "Fixture rider"],
  ] as const;

  for (const [path, visibleText] of cases) {
    const { body, response } = await raw(path);
    expect(response.status, path).toBe(200);
    expectDescriptionAndImageAlt(body);
    expectDocumentHeaders(response);
    expect(body, path).toContain(visibleText);
    expect(body, path).toContain('data-ferry-fyi-render-mode="snapshot"');
    expect(body, path).toContain('id="ferry-fyi-public-ssr-snapshot"');
    expect(body, path).not.toContain('data-seo-seed="true" id="seo-content"');
    expect(body, path).not.toContain(privateCanary);
  }

  const dated = await raw("/seattle?date=2026-08-01");
  expectDescriptionAndImageAlt(dated.body);
  expect(dated.body).toContain('"robots":"noindex,follow"');
  const today = await raw("/", { host: "howmanyboats.today" });
  expect(today.response.status).toBe(200);
  expectDescriptionAndImageAlt(today.body);
  expect(today.body).toContain("howmanyboats.today");
  expect(today.body).toContain("How Many Boats Are There Today?");
  expect(today.body).not.toContain("Loading ferry routes and terminals");
  expect(today.body).toContain('data-ferry-fyi-render-mode="snapshot"');
  const ferryToday = await raw("/today");
  expect(ferryToday.response.status).toBe(200);
  expectDescriptionAndImageAlt(ferryToday.body);
  expect(ferryToday.body).toContain("How Many Boats Are There Today?");
  for (const sourceKey of [
    "route",
    "schedule",
    "nextSchedule",
    "wsf",
    "notices",
  ]) {
    expect(today.body).toContain(`data-public-ssr-source="${sourceKey}"`);
    expect(ferryToday.body).toContain(`data-public-ssr-source="${sourceKey}"`);
  }
  expect(today.body).toContain("Page generated");
  expect(ferryToday.body).toContain("Page generated");
  expect(today.body).not.toContain(privateCanary);
  expect(ferryToday.body).not.toContain(privateCanary);

  const alternateTodayAlias = await raw("/today?utm=canary", {
    host: "howmanyboats.today",
    redirect: "manual",
  });
  expect(alternateTodayAlias.response.status).toBe(301);
  expect(alternateTodayAlias.response.headers.get("location")).toBe("/");
  expect(alternateTodayAlias.body).not.toContain(
    'data-ferry-fyi-render-mode="snapshot"'
  );

  const alternateNonRoot = await raw("/about?utm=canary", {
    host: "howmanyboats.today",
    redirect: "manual",
  });
  expect(alternateNonRoot.response.status).toBe(301);
  expect(alternateNonRoot.response.headers.get("location")).toBe(
    "https://ferry.fyi/about"
  );
  expect(alternateNonRoot.body).not.toContain(
    'data-ferry-fyi-render-mode="snapshot"'
  );
});

// recover indexed numeric links before rendering a canonical public document
test("redirects legacy terminal ids without carrying private query state", async () => {
  const legacy = await raw("/3/alerts?utm_source=bing&token=canary", {
    redirect: "manual",
  });
  expect(legacy.response.status).toBe(301);
  expect(legacy.response.headers.get("location")).toBe("/bainbridge/alerts");
  expect(legacy.body).not.toContain("canary");
  expect(legacy.body).not.toContain('id="ferry-fyi-public-ssr-snapshot"');
  const canonical = await raw("/bainbridge/alerts");
  expect(canonical.response.status).toBe(200);
  expectDocumentHeaders(canonical.response);
  expect(canonical.body).toContain(
    'href="https://ferry.fyi/bainbridge/alerts"'
  );
  expect(canonical.body).not.toContain(privateCanary);
});

// verify web manual fallback and published privacy
test("@automatic-checkins keeps web manual-only and publishes the native privacy contract", async ({
  page,
}) => {
  // preserve the privacy-safe public snapshot for deterministic browser assertions
  await page.route(/\/assets\/entry-client\.[^/]+\.js$/, (route) =>
    route.abort()
  );
  const leaderboard = await page.goto(
    "https://ferry.fyi:4177/leaderboards/terminals/7",
    { waitUntil: "domcontentloaded" }
  );
  expect(leaderboard?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Seattle" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Automatic leaderboard check-ins" })
  ).toHaveCount(0);
});

// verify the published privacy contract independently
test("@automatic-checkins publishes the native privacy contract", async ({
  page,
}) => {
  // preserve the privacy-safe public snapshot for deterministic browser assertions
  await page.route(/\/assets\/entry-client\.[^/]+\.js$/, (route) =>
    route.abort()
  );
  const privacy = await page.goto("https://ferry.fyi:4177/privacy", {
    waitUntil: "domcontentloaded",
  });
  expect(privacy?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Privacy Policy" })
  ).toBeVisible();
  // require the complete policy in initial HTML rather than a lazy chunk
  await expect(page.locator("main")).toContainText(
    "Optional automatic check-ins"
  );
  await expect(page.locator("main")).toContainText(
    "becomes ineligible exactly 12 hours"
  );
  await expect(page.locator("main")).toContainText(
    "Manual check-in remains available."
  );
  await expect(page.locator("main")).not.toContainText(privateCanary);
});

test("hydrates without replacing the root and refreshes anonymous data", async ({
  page,
}) => {
  const initial = await raw("/");
  expect(initial.body).toContain(">Seattle<");
  await fixture("/__fixture__/control", { refreshVersion: 2 });
  await installRootSentinel(page);
  const { promise: browserPhaseGate, resolve: releaseBrowserPhase } =
    Promise.withResolvers<void>();
  await page.route("**/assets/browserApp.*.js", async (route) => {
    await browserPhaseGate;
    await route.continue();
  });
  const hydrationDiagnostics: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (
      /hydration|react-recoverable-error|did not match|server rendered/i.test(
        text
      )
    ) {
      hydrationDiagnostics.push(text);
    }
  });

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
  expect(
    await page.evaluate(() => {
      const fixtureWindow = window as Window & {
        __fixtureInitialMeaningful?: Element;
      };
      return (
        fixtureWindow.__fixtureInitialMeaningful ===
          document.querySelector("#root a") &&
        document.activeElement === fixtureWindow.__fixtureInitialMeaningful
      );
    })
  ).toBe(true);
  releaseBrowserPhase();
  await page.waitForLoadState("networkidle");
  expect(pageErrors).toEqual([]);
  await expect(
    page.getByText("Seattle refreshed", { exact: true }).first()
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __fixtureInitialRoot?: Element })
          .__fixtureInitialRoot === document.querySelector("#root")
    )
  ).toBe(true);
  expect(hydrationDiagnostics).toEqual([]);
});

test("retains rendered schedule when post-hydration refresh is blocked", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort("failed"));
  await page.goto("/seattle", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", {
      name: "Seattle to Bainbridge Washington State Ferries schedule",
    })
  ).toBeVisible();
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  await expect(page.getByText(/\d+:\d+ [AP]M/).first()).toBeVisible();
});

test("retains alerts snapshot freshness when post-hydration refresh is blocked", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort("failed"));
  await page.goto("/seattle/alerts", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  const marker = page.locator('[data-live-freshness="bulletins"]');
  await expect(marker).toBeVisible();
  const timestamp = await marker.getAttribute("data-source-updated-at");
  expect(timestamp).toMatch(/^\d+$/);
  await page.waitForTimeout(500);
  await expect(marker).toHaveAttribute("data-source-updated-at", timestamp!);
});

// validate fixed Pacific origin reuse independent of ad placement
test("rolls the cache at 03:00 Pacific and does not commit a crossing fill", async () => {
  const cachePath = "/seattle/alerts";
  const before = await raw(cachePath);
  expect(before.body).toContain("Seattle");
  await fixture("/__fixture__/control", { refreshVersion: 2 });
  const sameDay = await raw(cachePath);
  expect(sameDay.body).toBe(before.body);

  await fixture("/__fixture__/control", {
    clock: "2026-07-29T10:00:00.000Z",
  });
  const nextDay = await raw(cachePath);
  expect(nextDay.body).toContain("Seattle refreshed");
  expect(nextDay.body).not.toBe(before.body);

  await fixture("/__fixture__/reset", {});
  await fixture("/__fixture__/control", {
    advanceAfterLoadTo: "2026-07-29T10:00:00.000Z",
  });
  const crossingFill = await raw(cachePath);
  expect(crossingFill.response.status).toBe(200);
  await fixture("/__fixture__/control", {
    advanceAfterLoadTo: null,
    refreshVersion: 2,
  });
  const retry = await raw(cachePath);
  expect(retry.body).toContain("Seattle refreshed");
  expect(retry.body).not.toBe(crossingFill.body);
});

// retain a safe description through the disabled-document browser handoff
test("serves the documents-disabled fallback with noindex intermediary headers", async ({
  page,
}) => {
  await fixture("/__fixture__/reset", {}, 4178);
  const disabled = await raw("/about", { port: 4178 });
  expect(disabled.response.status).toBe(200);
  expectDescriptionAndImageAlt(disabled.body);
  expect(disabled.body).toContain('data-ferry-fyi-render-mode="disabled"');
  expect(disabled.body).not.toContain("ferry-fyi-public-ssr-snapshot");
  expect(disabled.response.headers.get("x-robots-tag")).toBe(
    "noindex, noarchive"
  );
  expectDocumentHeaders(disabled.response);
  await page.goto("https://ferry.fyi:4178/about", { waitUntil: "networkidle" });
  await expectHydratedDescriptionAndImageAlt(page);
});

test("changes cache-disabled output after the fixture clock advances", async () => {
  await fixture("/__fixture__/reset", {}, 4179);
  const uncachedOne = await raw("/about", { port: 4179 });
  await fixture(
    "/__fixture__/control",
    { clock: "2026-07-29T10:00:00.000Z" },
    4179
  );
  const uncachedTwo = await raw("/about", { port: 4179 });
  expect(uncachedOne.response.status).toBe(200);
  expect(uncachedTwo.response.status).toBe(200);
  expect(uncachedTwo.body).not.toBe(uncachedOne.body);
});

// preserve hard errors while making the shared recovery links usable
test("serves a hydratable 404 document with intermediary headers", async ({
  page,
}) => {
  await fixture("/__fixture__/reset", {});
  const notFound = await raw("/not-a-ferry-page");
  expect(notFound.response.status).toBe(404);
  expectDescriptionAndImageAlt(notFound.body);
  expect(notFound.body).toContain("Page not found");
  expect(notFound.body).toContain('data-ferry-fyi-render-mode="snapshot"');
  expect(notFound.body).toContain('id="ferry-fyi-public-ssr-snapshot"');
  expectDocumentHeaders(notFound.response);
  const response = await page.goto("/not-a-ferry-page", {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(404);
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  await expect(
    page.getByRole("heading", { name: "Page not found" })
  ).toBeVisible();
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,follow"
  );
  await expectHydratedDescriptionAndImageAlt(page);
  await page.getByRole("link", { name: "Find a ferry schedule" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Ferry FYI", exact: true })
  ).toBeVisible();
});

test("serves machine discovery and isolates unknown API paths", async () => {
  for (const [path, type] of [
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "text/xml"],
    ["/llms.txt", "text/plain"],
    ["/openapi.json", "application/json"],
    ["/.well-known/security.txt", "text/plain"],
  ]) {
    const document = await raw(path, { authenticated: false });
    expect(document.response.status).toBe(200);
    expect(document.response.headers.get("content-type")).toContain(type);
    expect(document.response.headers.get("cache-control")).toContain(
      "public, max-age=300"
    );
  }

  const unknownApi = await raw("/api/not-a-real-operation", {
    authenticated: false,
  });
  expect(unknownApi.response.status).toBe(404);
  expect(unknownApi.response.headers.get("content-type")).toContain(
    "application/json"
  );
  expect(unknownApi.response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.parse(unknownApi.body)).toMatchObject({
    body: { error: "api_not_found" },
  });
});

test("retries a render failure without caching the failed response", async () => {
  await fixture("/__fixture__/reset", {});
  await fixture("/__fixture__/control", { failRenders: 1 });
  const failed = await raw("/about");
  expect(failed.response.status).toBe(503);
  expectDescriptionAndImageAlt(failed.body);
  expect(failed.response.headers.get("retry-after")).toBe("30");
  expect(failed.response.headers.get("x-robots-tag")).toBe(
    "noindex, noarchive"
  );
  expect(failed.body).toContain('data-ferry-fyi-render-mode="failure"');
  expect(failed.body).not.toContain("ferry-fyi-public-ssr-snapshot");
  expectDocumentHeaders(failed.response);
  const recovered = await raw("/about");
  expect(recovered.response.status).toBe(200);
  expect(recovered.body).toContain("About Ferry FYI");
  const cached = await raw("/about");
  expect(cached.body).toBe(recovered.body);
});

test("private and callback documents disclose no request or account state", async () => {
  for (const path of [
    "/account",
    "/admin",
    `/callback?code=${privateCanary}&state=${privateCanary}`,
  ]) {
    const { body, response } = await raw(path);
    expect(response.status).toBe(200);
    expectDescriptionAndImageAlt(body);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noarchive");
    expectDocumentHeaders(response);
    expect(body).not.toContain(privateCanary);
    expect(body).not.toContain("ferry-fyi-public-ssr-snapshot");
    expect(body).toMatch(/data-ferry-fyi-render-mode="(?:private|callback)"/);
  }
});

// verify credential independence on a route eligible for document reuse
test("shares public document bytes and cache identity with credential-bearing requests", async () => {
  const cachePath = "/seattle/alerts";
  const anonymous = await raw(cachePath, { authenticated: false });
  expect(anonymous.response.status).toBe(200);
  await fixture("/__fixture__/control", { refreshVersion: 2 });
  const credentialed = await raw(cachePath);
  expect(credentialed.response.status).toBe(200);
  expect(credentialed.body).toBe(anonymous.body);
  expect(credentialed.body).not.toContain(privateCanary);
  const state = await fixtureState();
  const telemetry = JSON.stringify(state.telemetry);
  expect(telemetry).not.toContain(privateCanary);
  expect(telemetry).not.toMatch(
    /authorization|cookie|user-agent|announcement|accessToken|userId/i
  );
});

test("uses client navigation across static, dynamic, and private routes without remounting", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const documentRequestUrls: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      documentRequestUrls.push(request.url());
    }
  });
  await page.goto("/about", { waitUntil: "networkidle" });
  expect(pageErrors).toEqual([]);
  expect(documentRequestUrls).toEqual(["https://ferry.fyi:4177/about"]);
  const rootIdentity = await page.locator("#root").evaluate((root) => {
    (window as Window & { __navigationRoot?: Element }).__navigationRoot = root;
    return true;
  });
  expect(rootIdentity).toBe(true);

  const scheduleLink = page.getByRole("link", { name: "Schedule" }).first();
  await scheduleLink.focus();
  await expect(scheduleLink).toBeFocused();
  expect(
    await scheduleLink.evaluate((link) =>
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
          cancelable: true,
        })
      )
    )
  ).toBe(false);
  await expect(page).toHaveURL("/");
  expect(documentRequestUrls).toEqual(["https://ferry.fyi:4177/about"]);
  await page.evaluate(() => {
    history.pushState({}, "", "/account");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL("/account");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __navigationRoot?: Element }).__navigationRoot ===
        document.querySelector("#root")
    )
  ).toBe(true);
  expect(documentRequestUrls).toEqual(["https://ferry.fyi:4177/about"]);
});

test("boots callback documents with create-mode recovery and no private seed", async ({
  page,
}) => {
  const response = await page.goto(`/callback?state=${privateCanary}`, {
    waitUntil: "networkidle",
  });
  expect(response?.status()).toBe(200);
  expect(await response?.text()).not.toContain(privateCanary);
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-render-mode",
    "callback"
  );
  await expect(page.locator("#root")).not.toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  expect(
    await page.locator("#root").evaluate((root) => root.hasChildNodes())
  ).toBe(true);
  expect(await page.locator("#ferry-fyi-public-ssr-snapshot").count()).toBe(0);
});

test("keeps static assets cacheable independently of document policy", async () => {
  const document = await raw("/about");
  const assetPath = document.body.match(
    /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/
  )?.[1];
  expect(assetPath).toBeTruthy();
  const asset = await raw(assetPath!);
  expect(asset.response.status).toBe(200);
  expect(asset.response.headers.get("cache-control")).not.toContain("no-store");

  const index = await raw("/index.html", { redirect: "manual" });
  expect(index.response.status).toBe(301);
  expect(index.response.headers.get("location")).toBe("/");
  expectDocumentHeaders(index.response);
  const offline = await raw("/offline.html");
  expect(offline.response.status).toBe(200);
  expectDescriptionAndImageAlt(offline.body);
  expectDocumentHeaders(offline.response);
});

test("installed production worker reaches SSR online and only the offline shell on failure", async ({
  context,
  page,
}) => {
  const workerSource = await raw("/service-worker.js");
  expect(workerSource.response.status).toBe(200);
  expect(workerSource.body).toContain("offline.html");
  expect(workerSource.body).not.toMatch(/url:["']index\.html["']/);

  await page.goto("/about", { waitUntil: "load" });
  expect(
    await page.evaluate(() => ({
      href: location.href,
      isSecureContext,
      serviceWorker: "serviceWorker" in navigator,
    }))
  ).toEqual({
    href: "https://ferry.fyi:4177/about",
    isSecureContext: true,
    serviceWorker: true,
  });
  const registrationScope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(registrationScope).toBe("https://ferry.fyi:4177/");
  await page.reload({ waitUntil: "networkidle" });
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
  ).toBe(true);

  const beforeOnlineNavigation = await fixtureState();
  const scheduleResponse = await page.goto("/seattle", {
    waitUntil: "networkidle",
  });
  const beforeRollover = await scheduleResponse?.text();
  expect(beforeRollover).toContain(
    "Seattle to Bainbridge Washington State Ferries schedule"
  );
  const afterOnlineNavigation = await fixtureState();
  expect(afterOnlineNavigation.requests).toBeGreaterThan(
    beforeOnlineNavigation.requests
  );
  expect(afterOnlineNavigation.fills).toBeGreaterThan(
    beforeOnlineNavigation.fills
  );
  await expect(
    page.getByText("Seattle", { exact: true }).first()
  ).toBeVisible();
  await fixture("/__fixture__/control", {
    clock: "2026-07-29T10:00:00.000Z",
    refreshVersion: 2,
  });
  const rolloverResponse = await page.goto("/seattle", {
    waitUntil: "networkidle",
  });
  const afterRollover = await rolloverResponse?.text();
  expect(afterRollover).toContain(
    "Seattle refreshed to Bainbridge Washington State Ferries schedule"
  );
  expect(afterRollover).not.toBe(beforeRollover);
  const afterRolloverState = await fixtureState();
  expect(afterRolloverState.requests).toBeGreaterThan(
    afterOnlineNavigation.requests
  );
  expect(afterRolloverState.fills).toBeGreaterThan(afterOnlineNavigation.fills);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const cache of await caches.keys()) {
          const opened = await caches.open(cache);
          if (
            (await opened.keys()).some(
              ({ url }) => new URL(url).pathname === "/offline.html"
            )
          ) {
            return true;
          }
        }
        return false;
      })
    )
    .toBe(true);
  const cachedRequests = await page.evaluate(async () => {
    const results: { cache: string; url: string }[] = [];
    for (const cache of await caches.keys()) {
      const opened = await caches.open(cache);
      for (const request of await opened.keys()) {
        results.push({ cache, url: request.url });
      }
    }
    return results;
  });
  expect(
    cachedRequests.some(({ url }) => new URL(url).pathname === "/offline.html")
  ).toBe(true);
  expect(
    cachedRequests.some(({ url }) => new URL(url).pathname === "/seattle")
  ).toBe(false);
  expect(
    cachedRequests
      .filter(({ cache }) => cache.includes("api"))
      .every(({ url }) => new URL(url).pathname.startsWith("/api/"))
  ).toBe(true);

  await context.setOffline(true);
  await page.goto("/seattle", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "You’re offline" })
  ).toBeVisible();
  expect(
    await page.locator("#offline-root").getAttribute("data-document-mode")
  ).toBe("csr-offline");
  expect(await page.locator("#root").count()).toBe(0);
  expect(await page.locator("#ferry-fyi-public-ssr-snapshot").count()).toBe(0);
});

// prove full meaningful documents with scripts disabled
for (const [path, title, required] of [
  ["/about", "Ferry FYI", ["Open-Meteo", "forecasts"]],
  [
    "/data-sources",
    "Data sources and API guide",
    [
      "Data sources and freshness",
      "Citing Ferry FYI data",
      "Corrections and limits",
      "/api/fares/catalog",
    ],
  ],
  [
    "/forecasting",
    "Forecasting",
    ["How delay forecasts work", "Why confidence changes", "Booth lines"],
  ],
  [
    "/privacy",
    "Privacy Policy",
    ["Optional automatic check-ins", "advertising", "Google"],
  ],
  ["/terms", "Terms of Service", ["Google", "Supporter", "Liability"]],
  ["/support", "Support", ["Supporter", "Email Support"]],
  ["/install", "Install", ["iPhone and iPad", "Android", "Web app"]],
  [
    "/supporter",
    "Support an independent ferry app",
    ["Supporter benefits", "Billing and account access", "renew automatically"],
  ],
  [
    "/tickets",
    "Tickets",
    [
      "Using your ticket wallet",
      "No saved tickets yet",
      "Buy multi-ride passes",
    ],
  ],
] as const) {
  test(`full static initial HTML without JavaScript: ${path}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    try {
      const result = await page.goto(`https://ferry.fyi:4177${path}`);
      expect(result?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(title);
      for (const text of required) {
        await expect(page.locator("main")).toContainText(text, {
          ignoreCase: true,
        });
      }
      const headings = await page
        .locator("main h1, main h2, main h3, main h4")
        .evaluateAll((nodes) =>
          nodes.map((node) => Number(node.tagName.slice(1)))
        );
      expect(headings[0]).toBe(1);
      headings.forEach((level, index) =>
        expect(level - (headings[index - 1] ?? 0)).toBeLessThanOrEqual(1)
      );
      expect(await page.locator("img:not([alt])").count()).toBe(0);
    } finally {
      await context.close();
    }
  });

  // retain meaningful copy and one page heading after compatible hydration
  test(`full static content after hydration: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`https://ferry.fyi:4177${path}`, {
      waitUntil: "networkidle",
    });
    await expect(page.locator("#root")).toHaveAttribute(
      "data-ferry-fyi-snapshot-consumed",
      "true"
    );
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(title);
    // compare the same public fact oracle after browser enhancement
    for (const text of required) {
      await expect(page.locator("main")).toContainText(text, {
        ignoreCase: true,
      });
    }
    await expectHydratedDescriptionAndImageAlt(page);
    expect(errors).toEqual([]);
  });
}

// keep focused manual entry free of purchase distractions
test("hides ticket purchase links during manual entry and restores them on cancel", async ({
  page,
}) => {
  await page.goto("/tickets", { waitUntil: "networkidle" });
  const reservation = page.getByRole("link", { name: "Make a reservation" });
  const passes = page.getByRole("link", { name: "Buy multi-ride passes" });
  await expect(reservation).toBeVisible();
  await expect(passes).toBeVisible();

  await page.getByRole("button", { name: "Manual Type code" }).click();
  await expect(
    page.getByRole("textbox", { name: "Ticket number" })
  ).toBeVisible();
  await expect(reservation).toHaveCount(0);
  await expect(passes).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Ticket number" })
  ).toHaveCount(0);
  await expect(reservation).toBeVisible();
  await expect(passes).toBeVisible();
});

// native disclosure contains every fare before any client request
test("opens the full fare table without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto("https://ferry.fyi:4177/seattle/fare");
    const details = page.locator("details[data-public-fare-catalog]");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.locator("tbody tr")).toHaveCount(2);
    await expect(details.locator("table")).not.toBeVisible();
    await expect(
      page.locator('[aria-label="Fare estimator"] + details')
    ).toHaveCount(1);
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details.locator("table")).toBeVisible();
    await expect(details).toContainText("$22.25");
    await expect(details).toContainText("Direction-independent");
    await page.keyboard.press("Enter");
    await expect(details.locator("table")).not.toBeVisible();
  } finally {
    await context.close();
  }
});

// keep seeded fare rows through hydration and failed live refresh
test("retains one full fare table through hydrated browser refresh failure", async ({
  page,
}) => {
  // align the selected date with the seeded service day after 03:00
  const now = "2026-07-29T12:00:00.000Z";
  await fixture("/__fixture__/control", { clock: now });
  await page.clock.setFixedTime(now);
  const diagnostics: string[] = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => {
    if (/hydration|did not match|react-recoverable/i.test(message.text())) {
      diagnostics.push(message.text());
    }
  });
  await page.route("**/api/fares/catalog**", (route) => route.abort("failed"));
  await page.goto("/seattle/fare", { waitUntil: "networkidle" });
  await expect(page.locator("#root")).toHaveAttribute(
    "data-ferry-fyi-snapshot-consumed",
    "true"
  );
  await expect(
    page.getByText("How are you traveling?", { exact: true })
  ).toBeVisible();
  await expect(page.locator("details[data-public-fare-catalog]")).toHaveCount(
    1
  );
  await expect(page.locator("details tbody tr")).toHaveCount(2);
  await expect(
    page.locator('[aria-label="Fare estimator"] + details')
  ).toHaveCount(1);
  await page.locator("details summary").click();
  await expect(page.locator("details table")).toBeVisible();
  expect(diagnostics).toEqual([]);
});

// verify dynamic facts are readable without client SDKs
for (const [path, facts] of [
  ["/", ["Terminal locations", "Seattle", "1 Ferry Dock"]],
  [
    "/today",
    [
      "Clinton to Mukilteo",
      "Current service date",
      "Next service date",
      "Fixture Ferry",
    ],
  ],
  ["/leaderboards", ["All time", "Seattle", "Fixture Ferry"]],
  ["/leaderboards/terminals/7", ["Fixture rider", "42", "Supporter badge"]],
  [
    "/seattle",
    [
      "Selected service date",
      "Next service date",
      "Arrival",
      "76 vehicle spaces reported",
      "Confidence: high",
      "Fixture afternoon demand",
      "20°C",
      "1.5 m",
    ],
  ],
  [
    "/seattle/cameras",
    [
      "Seattle holding area",
      "Camera: active",
      "Holding capacity: 20 cars",
      "Camera location: 5 car spaces from the boat",
    ],
  ],
  [
    "/seattle/terminal",
    [
      "Fixture parking & connections",
      "Accessible boarding assistance",
      "One sailing wait",
      "35 minutes",
      "Facilities",
    ],
  ],
  [
    "/seattle/map",
    [
      "Terminal coordinates",
      "Fixture Ferry",
      "In service: yes",
      "Heading: 90°",
      "Speed: 12 knots",
    ],
  ],
  [
    "/seattle/alerts",
    ["Fixture service alert", "Fixture terminal notice", "info"],
  ],
  [
    "/seattle/subscribe",
    ["Alert subscriptions are personal", "Sign in", "notification permissions"],
  ],
] as const) {
  test(`full dynamic initial HTML without JavaScript: ${path}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    try {
      await page.goto(`https://ferry.fyi:4177${path}`);
      for (const fact of facts) {
        await expect(page.locator("main")).toContainText(fact);
      }
      await expect(page.locator("main time").first()).toBeVisible();
      expect(await page.locator("img:not([alt])").count()).toBe(0);
      if (path.startsWith("/seattle")) {
        await expect(
          page.getByRole("navigation", { name: "Route navigation" })
        ).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}

// persist ad-bearing documents and invalidate changed effective creatives
test("caches public ads and invalidates their relevant document variants", async () => {
  const first = await raw("/seattle/fare");
  expect(first.body).toContain("Fixture dockside coffee");
  await fixture("/__fixture__/control", { refreshVersion: 2 });
  const hit = await raw("/seattle/fare");
  expect(hit.body).toBe(first.body);
  expect((await fixtureState()).fills).toBe(1);
  await fixture("/__fixture__/control", { adHeadline: "New fixture creative" });
  const changed = await raw("/seattle/fare");
  expect(changed.body).toContain("New fixture creative");
  expect(changed.body).not.toContain("Fixture dockside coffee");
  expect(changed.body).toContain("Seattle refreshed");
  await fixture("/__fixture__/control", { adEnabled: false });
  const disabled = await raw("/seattle/fare");
  expect(disabled.body).not.toContain("New fixture creative");
  expect(disabled.body).not.toContain('data-ad-click-target="true"');
  await fixture("/__fixture__/control", { adEnabled: true });
  const enabled = await raw("/seattle/fare");
  expect(enabled.body).toContain("New fixture creative");
  expect((await fixtureState()).fills).toBe(4);
});

// keep morning snapshots until the fixed afternoon boundary
test("refreshes at 15:00 Pacific rather than a rolling twelve-hour TTL", async () => {
  await fixture("/__fixture__/control", { clock: "2026-07-29T10:00:00.000Z" });
  const morning = await raw("/seattle/alerts");
  await fixture("/__fixture__/control", {
    clock: "2026-07-29T21:59:59.999Z",
    refreshVersion: 2,
  });
  expect((await raw("/seattle/alerts")).body).toBe(morning.body);
  await fixture("/__fixture__/control", { clock: "2026-07-29T22:00:00.000Z" });
  const afternoon = await raw("/seattle/alerts");
  expect(afternoon.body).not.toBe(morning.body);
  expect(afternoon.body).toContain("Seattle refreshed");
});
