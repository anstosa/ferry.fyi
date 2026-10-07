import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { describe, expect, it } from "vitest";

import {
  type AppRenderContextValue,
  AppRenderProvider,
} from "../../client/lib/renderContext";
import { NotFound } from "../../client/views/NotFound";
import {
  createStaticPublicSsrTerminalResolver,
  matchPublicSsrRoute,
} from "../../shared/lib/ssrRouteMatch";

type HelmetContext = Record<string, unknown> & {
  helmet?: {
    link: { toString(): string };
    meta: { toString(): string };
    title: { toString(): string };
  };
};

// render the fixed response against an injected request
const renderNotFound = (
  requestUrl: string
): { head: string; markup: string } => {
  const url = new URL(requestUrl);
  const context: AppRenderContextValue = {
    clock: () => 1_700_000_000_000,
    hasInjectedRequest: true,
    platform: "web",
    requestUrl,
    runtime: "server",
    seoBaseUrl: "https://ferry.fyi",
    seoHost: "ferry.fyi",
    seoPathname: url.pathname,
  };
  const helmetContext: HelmetContext = {};
  const markup = renderToStaticMarkup(
    <AppRenderProvider value={context}>
      <HelmetProvider context={helmetContext}>
        <NotFound />
      </HelmetProvider>
    </AppRenderProvider>
  );
  const { helmet } = helmetContext;

  return {
    head: [
      helmet?.title.toString(),
      helmet?.meta.toString(),
      helmet?.link.toString(),
    ].join(""),
    markup,
  };
};

describe("not-found page", () => {
  // preserve useful recovery actions in the eager response
  it("renders branded ferry guidance and direct canonical links", () => {
    const { markup } = renderNotFound("https://ferry.fyi/missing");

    expect(markup).toContain("Page not found");
    expect(markup).toContain("this page missed the boat");
    expect(markup).toContain("Find a ferry schedule");
    expect(markup).toContain('href="/seattle/bainbridge"');
    expect(markup).toContain('href="/edmonds"');
    expect(markup).toContain('href="/mukilteo"');
    expect(markup).toContain('href="/support"');
    expect(markup).not.toContain("data-react-router-link");
  });

  // prove linked schedules already use static canonical paths
  it("links directly to canonical schedule routes", () => {
    const resolver = createStaticPublicSsrTerminalResolver();

    expect(
      matchPublicSsrRoute(
        new URL("https://ferry.fyi/seattle/bainbridge"),
        resolver
      )
    ).toMatchObject({ canonicalPath: "/seattle/bainbridge" });
    expect(
      matchPublicSsrRoute(new URL("https://ferry.fyi/edmonds"), resolver)
    ).toMatchObject({ canonicalPath: "/edmonds" });
    expect(
      matchPublicSsrRoute(new URL("https://ferry.fyi/mukilteo"), resolver)
    ).toMatchObject({ canonicalPath: "/mukilteo" });
  });

  // keep unknown request values out of both markup and metadata
  it("keeps the response request-neutral and noindex", () => {
    const first = renderNotFound(
      "https://ferry.fyi/private-one?token=first-canary"
    );
    const second = renderNotFound(
      "https://ferry.fyi/private-two?secret=second-canary"
    );
    const document = `${first.head}${first.markup}`;

    expect(first.markup).toBe(second.markup);
    expect(document).not.toContain("canary");
    expect(document).toContain("Page Not Found - Ferry FYI");
    expect(document).toContain('content="noindex,follow"');
    expect(document).toContain('href="https://ferry.fyi/404"');
  });
});
