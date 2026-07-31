import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";
import React from "react";
import { describe, expect, it } from "vitest";

import { createServerApp } from "../../client/entry-server";
import {
  assemblePublicSsrDocument,
  assemblePublicSsrMarkerDocument,
  type PublicSsrStreamRenderer,
  renderPublicSsrApp,
  renderPublicSsrDocument,
  serializePublicSsrSnapshot,
} from "../../server/ssr/document";
import { createPublicSsrSnapshotLoader } from "../../server/ssr/publicSnapshot";
import type { PublicSsrSnapshot } from "../../shared/contracts/ssr";
import {
  PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE,
  PUBLIC_SSR_SNAPSHOT_SCRIPT_ID,
} from "../../shared/contracts/ssrDocument";

const template = `<!doctype html><html><head></head><body><div id="root"><div id="seo-content">fallback</div></div></body></html>`;
const realTemplate = readFileSync(
  path.resolve(process.cwd(), "client/index.html"),
  "utf8"
);
const unavailable = (): Promise<never> =>
  Promise.reject(new Error("not needed for the About snapshot"));

const loadAboutSnapshot = async (): Promise<PublicSsrSnapshot> => {
  const loadSnapshot = createPublicSsrSnapshotLoader({
    services: {
      getCameraFrames: unavailable,
      getContent: unavailable,
      getFareCatalog: unavailable,
      getLeaderboard: unavailable,
      getPublicLeaderboardsEnabled: unavailable,
      getSchedule: unavailable,
      getTerminals: unavailable,
      getVessels: unavailable,
      getWsfStatus: unavailable,
    },
  });
  const loaded = await loadSnapshot({
    absoluteUrl: "https://ferry.fyi/about",
    contentRevision: "test",
    fixedClock: new Date("2026-07-28T12:00:00.000Z"),
    release: { publishedAt: null, version: "test" },
  });
  if (loaded.classification !== "snapshot") {
    throw new Error("Expected a public About snapshot");
  }
  return loaded.snapshot;
};

describe("SSR document protocol", () => {
  it("serializes a valid snapshot as inert JSON without a script breakout", async () => {
    const snapshot = await loadAboutSnapshot();
    const serialized = serializePublicSsrSnapshot({
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        description: "</script><tag>\u2028\u2029",
      },
    });

    expect(serialized).toContain("\\u003c/script>");
    expect(serialized).not.toContain("</script");
    expect(serialized).toContain("\\u2028\\u2029");
  });

  it("rejects forged private data before serialization or assembly", async () => {
    const snapshot = await loadAboutSnapshot();
    const forged = { ...snapshot, privateCanary: "must-not-serialize" };

    expect(() => serializePublicSsrSnapshot(forged)).toThrow(
      "Invalid public SSR snapshot shape"
    );
    expect(() =>
      assemblePublicSsrDocument({
        appMarkup: "<main>ignored</main>",
        helmetContext: {},
        snapshot: forged,
        template,
      })
    ).toThrow("Invalid public SSR snapshot shape");
  });

  it("assembles complete app output, Helmet tags, and no generic SEO fallback", async () => {
    const snapshot = await loadAboutSnapshot();
    const html = assemblePublicSsrDocument({
      appMarkup: "<main>complete application</main>",
      helmetContext: {
        helmet: {
          link: { toString: () => '<link rel="canonical" href="/about">' },
          meta: {
            toString: () => '<meta name="robots" content="index,follow">',
          },
          noscript: { toString: () => "<noscript>safe</noscript>" },
          script: { toString: () => "" },
          style: { toString: () => "" },
          title: { toString: () => "<title>About</title>" },
        },
      },
      snapshot,
      template,
    });

    expect(html).toContain("complete application");
    expect(html).toContain("<title>About</title>");
    expect(html).toContain(`${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="snapshot"`);
    expect(html).toContain(`id="${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}"`);
    expect(html).not.toContain("fallback");
    expect(html).not.toContain("</script><tag>");
  });

  it("replaces the nested real root completely and leaves one SSR protocol", async () => {
    const snapshot = await loadAboutSnapshot();
    const html = assemblePublicSsrDocument({
      appMarkup: "<main>server complete</main>",
      helmetContext: {
        helmet: {
          link: { toString: () => "" },
          meta: { toString: () => "" },
          noscript: { toString: () => "" },
          script: { toString: () => "" },
          style: { toString: () => "" },
          title: { toString: () => "" },
        },
      },
      snapshot,
      template: realTemplate,
    });

    expect(html.match(/id="root"/g)).toHaveLength(1);
    expect(html).toContain("<main>server complete</main></div>");
    expect(
      new JSDOM(html).window.document.querySelectorAll(
        `#root[${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="snapshot"]`
      )
    ).toHaveLength(1);
    expect(
      html.match(new RegExp(PUBLIC_SSR_SNAPSHOT_SCRIPT_ID, "g"))
    ).toHaveLength(1);
    expect(html).not.toContain("data-seo-seed");
    expect(html).not.toContain("Loading Ferry FYI");
  });

  it("rejects a template without a complete root document boundary", async () => {
    const snapshot = await loadAboutSnapshot();

    expect(() =>
      assemblePublicSsrDocument({
        appMarkup: "<main>ignored</main>",
        helmetContext: {},
        snapshot,
        template: '<html><head></head><body><div id="root">',
      })
    ).toThrow("required document boundary");
  });

  it("uses non-sensitive marker-only documents for callback, private, and failure paths", () => {
    for (const mode of ["callback", "private", "failure"] as const) {
      const html = assemblePublicSsrMarkerDocument(realTemplate, mode);
      expect(html).toContain(`${PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE}="${mode}"`);
      expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
      expect(html).not.toContain(PUBLIC_SSR_SNAPSHOT_SCRIPT_ID);
      expect(html).not.toContain("must-not-be-accepted-by-render-boundary");
      expect(html).not.toContain("data-seo-seed");
      expect(html).not.toContain("Loading Ferry FYI");
    }
  });

  it("rejects an invalid snapshot before invoking the server entry", async () => {
    let rendered = false;
    await expect(
      renderPublicSsrDocument({
        context: {
          clock: () => 0,
          platform: "web",
          requestUrl: "https://ferry.fyi/about",
          runtime: "server",
          seoBaseUrl: "https://ferry.fyi",
          seoHost: "ferry.fyi",
          seoPathname: "/about",
        },
        entry: {
          createServerApp: () => {
            rendered = true;
            return React.createElement("main");
          },
        },
        snapshot: { accessToken: "nope" },
        template,
      })
    ).rejects.toThrow("forbidden key");
    expect(rendered).toBe(false);
  });

  it("renders a validated snapshot through the real server entry and Helmet", async () => {
    const snapshot = await loadAboutSnapshot();
    const result = await renderPublicSsrDocument({
      context: {
        clock: () => 1_753_704_000_000,
        platform: "web",
        requestUrl: "https://ferry.fyi/about",
        runtime: "server",
        seoBaseUrl: "https://ferry.fyi",
        seoHost: "ferry.fyi",
        seoPathname: "/about",
      },
      entry: { createServerApp },
      snapshot,
      template: realTemplate,
    });

    const { document } = new JSDOM(result.html).window;
    const root = document.querySelector("#root");
    const snapshotScript = document.querySelector(
      `#${PUBLIC_SSR_SNAPSHOT_SCRIPT_ID}`
    );
    expect(root).not.toBeNull();
    expect(document.querySelectorAll("#root")).toHaveLength(1);
    expect(root?.getAttribute(PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE)).toBe(
      "snapshot"
    );
    expect(
      root
        ?.getAttributeNames()
        .filter((name) => name === PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE)
    ).toHaveLength(1);
    expect(root?.textContent).toContain("A ferry schedule and tracker");
    expect(document.title).toBe(snapshot.metadata.title);
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
    ).toBe(snapshot.metadata.description);
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href")
    ).toBe("https://ferry.fyi/about");
    expect(document.querySelectorAll("[data-seo-seed]")).toHaveLength(0);
    expect(root?.textContent).not.toContain("Loading Ferry FYI");
    expect(snapshotScript).not.toBeNull();
    expect(snapshotScript?.getAttribute("type")).toBe("application/json");
    expect(snapshotScript?.parentElement).toBe(document.body);
    expect(JSON.parse(snapshotScript?.textContent ?? "")).toEqual(snapshot);
    expect(
      document.querySelector('script[type="module"][src="/entry-client.tsx"]')
    ).not.toBeNull();
  }, 30_000);

  it("rejects on a render error without returning partial HTML", async () => {
    let aborted = false;
    const renderer = ((_element, options) => {
      queueMicrotask(() => options.onError?.(new Error("render canary")));
      return { abort: () => (aborted = true), pipe: () => undefined };
    }) as PublicSsrStreamRenderer;

    await expect(
      renderPublicSsrApp(React.createElement("main", null, "partial"), renderer)
    ).rejects.toThrow("render canary");
    expect(aborted).toBe(true);
  });

  it("rejects and aborts on a shell error", async () => {
    let aborted = false;
    const renderer = ((_element, options) => {
      queueMicrotask(() => options.onShellError?.(new Error("shell canary")));
      return { abort: () => (aborted = true), pipe: () => undefined };
    }) as PublicSsrStreamRenderer;

    await expect(
      renderPublicSsrApp(React.createElement("main", null, "partial"), renderer)
    ).rejects.toThrow("shell canary");
    expect(aborted).toBe(true);
  });

  it("preserves the render error when abort cleanup throws", async () => {
    const renderer = ((_element, options) => {
      queueMicrotask(() => options.onError?.(new Error("render canary")));
      return {
        abort: () => {
          throw new Error("abort canary");
        },
        pipe: () => undefined,
      };
    }) as PublicSsrStreamRenderer;

    await expect(
      renderPublicSsrApp(React.createElement("main", null, "partial"), renderer)
    ).rejects.toThrow("render canary");
  });

  it("rejects post-all-ready errors without exposing partial output", async () => {
    let aborted = false;
    const renderer = ((_element, options) => {
      const stream = {
        abort: () => (aborted = true),
        pipe: (output: import("node:stream").PassThrough) => {
          output.write("partial output");
          queueMicrotask(() => options.onError?.(new Error("late canary")));
        },
      };
      queueMicrotask(() => options.onAllReady?.());
      return stream;
    }) as PublicSsrStreamRenderer;

    await expect(
      renderPublicSsrApp(React.createElement("main", null, "partial"), renderer)
    ).rejects.toThrow("late canary");
    expect(aborted).toBe(true);
  });

  it("rejects and aborts if piping the all-ready stream fails", async () => {
    let aborted = false;
    const renderer = ((_element, options) => {
      const stream = {
        abort: () => (aborted = true),
        pipe: () => {
          throw new Error("pipe canary");
        },
      };
      queueMicrotask(() => options.onAllReady?.());
      return stream;
    }) as PublicSsrStreamRenderer;

    await expect(
      renderPublicSsrApp(React.createElement("main", null, "partial"), renderer)
    ).rejects.toThrow("pipe canary");
    expect(aborted).toBe(true);
  });
});
