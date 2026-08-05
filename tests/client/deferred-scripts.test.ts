import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appSource = readFileSync("client/App.tsx", "utf-8");
const analyticsSource = readFileSync("client/lib/analytics.ts", "utf-8");
const appRootSource = readFileSync("client/AppRoot.tsx", "utf-8");
const appStyles = readFileSync("client/app.scss", "utf-8");
const deviceSource = readFileSync("client/lib/device.ts", "utf-8");
const entryBootstrapSource = readFileSync("client/entry-bootstrap.ts", "utf-8");
const entryClientSource = readFileSync("client/entry-client.tsx", "utf-8");
const indexHtml = readFileSync("client/index.html", "utf-8");
const viteConfigSource = readFileSync("client/vite.config.ts", "utf-8");

describe("client document loading", () => {
  it("loads analytics and native device details after the app is interactive", () => {
    expect(indexHtml).not.toContain("googletagmanager.com");
    expect(appSource).toContain("deferAnalytics");
    expect(analyticsSource).toContain('import("react-ga4")');
    expect(analyticsSource).not.toContain('import ReactGA from "react-ga4"');
    expect(deviceSource).toContain('import("@capacitor/device")');
    expect(deviceSource).not.toContain(
      'import { Device } from "@capacitor/device"'
    );
  });

  it("lets the render-blocking application stylesheet reveal SSR immediately", () => {
    expect(indexHtml).toContain('<link href="/app.scss" rel="stylesheet" />');
    expect(indexHtml).not.toContain("ferry-fyi-ssr-style-gate");
    expect(indexHtml).not.toContain("data-ferry-fyi-styles-ready");
    expect(viteConfigSource).not.toContain("ferry-app-styles-ready");
    expect(viteConfigSource).not.toContain("data-ferry-fyi-styles-ready");
    expect(appSource).not.toContain('import "./app.scss"');
    expect(appRootSource).not.toContain('import "./app.scss"');
  });

  it("self-hosts a conservative font subset without third-party font requests", () => {
    expect(indexHtml).not.toContain("fonts.googleapis.com");
    expect(indexHtml).not.toContain("fonts.gstatic.com");
    expect(indexHtml).not.toContain('as="font"');
    expect(appStyles).toContain('font-family: "Ferry Sans Flex"');
    expect(appStyles).toContain('url("./fonts/ferry-sans-flex-latin.woff2")');
    expect(appStyles).toContain(
      'url("./fonts/ferry-sans-flex-latin-ext.woff2")'
    );
    expect(appStyles).toContain("font-display: swap");
  });

  it("only inlines the home LCP logo at its explicit import site", () => {
    const homeHeroSource = readFileSync(
      "client/components/HomeHero.tsx",
      "utf-8"
    );
    expect(homeHeroSource).toContain("icon_monochrome-256.png?inline");
    expect(viteConfigSource).not.toContain("assetsInlineLimit");
  });

  it("loads hydration and telemetry only after the initial document can paint", () => {
    expect(indexHtml).toContain(
      '<script type="module" src="/entry-bootstrap.ts"></script>'
    );
    expect(indexHtml).not.toContain(
      '<script type="module" src="/entry-client.tsx"></script>'
    );
    expect(entryBootstrapSource).toContain('import("./entry-client")');
    expect(entryBootstrapSource).toContain('import("./lib/worker")');
    expect(entryBootstrapSource).toContain('import("./lib/sentry")');
    expect(entryBootstrapSource).toContain("requestAnimationFrame");
    expect(entryClientSource).not.toContain("startSentry");
  });
});
