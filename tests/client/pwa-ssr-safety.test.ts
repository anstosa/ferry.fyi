import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  OFFLINE_DOCUMENT_URL,
  registerNetworkOnlyNavigationRoute,
} from "../../client/lib/serviceWorkerNavigation";

const repoRoot = path.resolve(__dirname, "../..");
const readRepoFile = (file: string) =>
  readFile(path.join(repoRoot, file), "utf8");

interface TestPlugin {
  handlerDidError: () => Promise<Response>;
}

class TestNetworkOnly {
  readonly plugins: TestPlugin[];

  constructor(options: { plugins: TestPlugin[] }) {
    this.plugins = options.plugins;
  }

  async handle(network: () => Promise<Response>): Promise<Response> {
    try {
      return await network();
    } catch {
      return this.plugins[0].handlerDidError();
    }
  }
}

describe("installed PWA SSR safety", () => {
  it("initializes Firebase messaging only in supported service workers", async () => {
    const source = await readRepoFile("client/service-worker.ts");

    expect(source).toContain("isSupported()");
    expect(source.indexOf("isSupported()")).toBeLessThan(
      source.indexOf("getMessaging(app)")
    );
  });

  it("keeps live vessel snapshots out of stale-while-revalidate caching", async () => {
    const source = await readRepoFile("client/service-worker.ts");
    const liveSnapshotRoute = source.indexOf(
      'registerRoute(new RegExp("/api/vessels/snapshot$"), new NetworkOnly())'
    );
    const staleVesselRoute = source.indexOf(
      'new RegExp("/api/(vessels|terminals)/.*")'
    );

    expect(liveSnapshotRoute).toBeGreaterThan(-1);
    expect(staleVesselRoute).toBeGreaterThan(-1);
    expect(liveSnapshotRoute).toBeLessThan(staleVesselRoute);
  });

  it("registers network-only navigations before Workbox precache routes", async () => {
    const source = await readRepoFile("client/service-worker.ts");
    const navigationRegistration = source.indexOf(
      "registerNetworkOnlyNavigationRoute({"
    );
    const precacheRegistration = source.indexOf(
      "precacheAndRoute((self as any).__WB_MANIFEST)"
    );

    expect(navigationRegistration).toBeGreaterThan(-1);
    expect(precacheRegistration).toBeGreaterThan(-1);
    expect(navigationRegistration).toBeLessThan(precacheRegistration);
  });

  it("matches every document navigation and excludes non-navigations", () => {
    let matcher: ((context: { request: Request }) => boolean) | undefined;
    const registerRoute = vi.fn((candidate) => {
      matcher = candidate;
    });

    registerNetworkOnlyNavigationRoute({
      matchPrecache: vi.fn(),
      NetworkOnly: TestNetworkOnly,
      registerRoute,
    });

    expect(registerRoute).toHaveBeenCalledOnce();
    expect(matcher).toBeDefined();
    for (const pathname of [
      "/",
      "/edmonds/kingston/schedule",
      "/edmonds/kingston/cameras",
      "/account",
      "/callback",
    ]) {
      expect(
        matcher?.({
          request: {
            mode: "navigate",
            url: `https://ferry.fyi${pathname}`,
          } as Request,
        })
      ).toBe(true);
    }
    expect(
      matcher?.({
        request: { mode: "cors", url: "https://ferry.fyi/api/v1" } as Request,
      })
    ).toBe(false);
  });

  it("returns successful network documents without consulting precache", async () => {
    let strategy: TestNetworkOnly | undefined;
    const matchPrecache = vi.fn();
    const networkResponse = new Response("server SSR");

    registerNetworkOnlyNavigationRoute({
      matchPrecache,
      NetworkOnly: TestNetworkOnly,
      registerRoute: (_matcher, candidate) => {
        strategy = candidate as TestNetworkOnly;
      },
    });

    await expect(
      strategy?.handle(async () => networkResponse)
    ).resolves.toBe(networkResponse);
    expect(matchPrecache).not.toHaveBeenCalled();
  });

  it("uses only the explicit offline document when navigation networking fails", async () => {
    let strategy: TestNetworkOnly | undefined;
    const offlineResponse = new Response("offline");
    const matchPrecache = vi.fn(async () => offlineResponse);

    registerNetworkOnlyNavigationRoute({
      matchPrecache,
      NetworkOnly: TestNetworkOnly,
      registerRoute: (_matcher, candidate) => {
        strategy = candidate as TestNetworkOnly;
      },
    });

    await expect(
      strategy?.handle(async () => {
        throw new Error("offline");
      })
    ).resolves.toBe(offlineResponse);
    expect(matchPrecache).toHaveBeenCalledOnce();
    expect(matchPrecache).toHaveBeenCalledWith(OFFLINE_DOCUMENT_URL);
  });

  it("provides a noindex CSR-only shell without an SSR snapshot or app bootstrap", async () => {
    const [html, entry] = await Promise.all([
      readRepoFile("client/offline.html"),
      readRepoFile("client/offline.ts"),
    ]);

    expect(html).toContain(
      '<meta name="robots" content="noindex,nofollow" />'
    );
    expect(html).toContain('content="csr-offline"');
    expect(html).toContain('data-document-mode="csr-offline"');
    expect(html).not.toContain("ferry-fyi-public-ssr-snapshot");
    expect(html).not.toContain("__FERRY_FYI_BOOTSTRAP__");
    expect(html).not.toContain("entry-client");
    expect(entry.toLowerCase()).not.toContain("auth0");
    expect(entry).not.toContain("fetch(");
    expect(entry).not.toContain("/api/");
  });
});
