import fs from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

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
    const root = page.locator("#root");
    await expect(root, `${label} root`).toHaveCount(1);
    if (
      (await root.getAttribute("data-ferry-fyi-render-mode")) === "snapshot"
    ) {
      await expect(root, `${label} hydration`).toHaveAttribute(
        "data-ferry-fyi-snapshot-consumed",
        "true"
      );
    }
    await page.waitForLoadState("networkidle");

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

test("serves page-specific React source from built artifacts", async () => {
  const cases = [
    ["/about", "About Ferry FYI"],
    ["/tickets", "Saved tickets and ticket lookup"],
    ["/seattle", "Seattle to Bainbridge schedule"],
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
    expectDocumentHeaders(response);
    expect(body, path).toContain(visibleText);
    expect(body, path).toContain('data-ferry-fyi-render-mode="snapshot"');
    expect(body, path).toContain('id="ferry-fyi-public-ssr-snapshot"');
    expect(body, path).not.toContain('data-seo-seed="true" id="seo-content"');
    expect(body, path).not.toContain(privateCanary);
  }

  const dated = await raw("/seattle?date=2026-08-01");
  expect(dated.body).toContain('"robots":"noindex,follow"');
  const today = await raw("/", { host: "howmanyboats.today" });
  expect(today.response.status).toBe(200);
  expect(today.body).toContain("howmanyboats.today");
  expect(today.body).toContain("How Many Boats Are There Today?");
  expect(today.body).not.toContain("Loading ferry routes and terminals");
  expect(today.body).toContain('data-ferry-fyi-render-mode="snapshot"');
  const ferryToday = await raw("/today");
  expect(ferryToday.response.status).toBe(200);
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
  // locate the hashed production privacy artifact
  // find one generated privacy-policy artifact
  const privacyArtifactName = fs
    .readdirSync(path.resolve(process.cwd(), "dist/client/assets"))
    // match only the privacy policy chunk
    .find((name) => /^PrivacyPolicy\.[^.]+\.js$/.test(name));
  expect(privacyArtifactName).toBeDefined();
  const privacyArtifact = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "dist/client/assets",
      privacyArtifactName as string
    ),
    "utf8"
  );
  expect(privacyArtifact).toContain("Optional automatic check-ins");
  expect(privacyArtifact).toContain("becomes ineligible exactly 12 hours");
  expect(privacyArtifact).toContain("Manual check-in remains available.");
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
    page.getByRole("heading", { name: "Seattle to Bainbridge schedule" })
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

test("rolls the cache at 03:00 Pacific and does not commit a crossing fill", async () => {
  const before = await raw("/");
  expect(before.body).toContain(">Seattle<");
  await fixture("/__fixture__/control", { refreshVersion: 2 });
  const sameDay = await raw("/");
  expect(sameDay.body).toBe(before.body);

  await fixture("/__fixture__/control", {
    clock: "2026-07-29T10:00:00.000Z",
  });
  const nextDay = await raw("/");
  expect(nextDay.body).toContain("Seattle refreshed");
  expect(nextDay.body).not.toBe(before.body);

  await fixture("/__fixture__/reset", {});
  await fixture("/__fixture__/control", {
    advanceAfterLoadTo: "2026-07-29T10:00:00.000Z",
  });
  const crossingFill = await raw("/");
  expect(crossingFill.response.status).toBe(200);
  await fixture("/__fixture__/control", {
    advanceAfterLoadTo: null,
    refreshVersion: 2,
  });
  const retry = await raw("/");
  expect(retry.body).toContain("Seattle refreshed");
  expect(retry.body).not.toBe(crossingFill.body);
});

test("serves the documents-disabled fallback with noindex intermediary headers", async () => {
  await fixture("/__fixture__/reset", {}, 4178);
  const disabled = await raw("/about", { port: 4178 });
  expect(disabled.response.status).toBe(200);
  expect(disabled.body).toContain('data-ferry-fyi-render-mode="disabled"');
  expect(disabled.body).not.toContain("ferry-fyi-public-ssr-snapshot");
  expect(disabled.response.headers.get("x-robots-tag")).toBe(
    "noindex, noarchive"
  );
  expectDocumentHeaders(disabled.response);
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

test("serves a hydratable 404 document with intermediary headers", async () => {
  await fixture("/__fixture__/reset", {});
  const notFound = await raw("/not-a-ferry-page");
  expect(notFound.response.status).toBe(404);
  expect(notFound.body).toContain("Page not found");
  expect(notFound.body).toContain('data-ferry-fyi-render-mode="snapshot"');
  expect(notFound.body).toContain('id="ferry-fyi-public-ssr-snapshot"');
  expectDocumentHeaders(notFound.response);
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
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noarchive");
    expectDocumentHeaders(response);
    expect(body).not.toContain(privateCanary);
    expect(body).not.toContain("ferry-fyi-public-ssr-snapshot");
    expect(body).toMatch(/data-ferry-fyi-render-mode="(?:private|callback)"/);
  }
});

test("shares public document bytes and cache identity with credential-bearing requests", async () => {
  const anonymous = await raw("/", { authenticated: false });
  expect(anonymous.response.status).toBe(200);
  await fixture("/__fixture__/control", { refreshVersion: 2 });
  const credentialed = await raw("/");
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
  expect(beforeRollover).toContain("Seattle to Bainbridge schedule");
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
  expect(afterRollover).toContain("Seattle refreshed to Bainbridge schedule");
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
