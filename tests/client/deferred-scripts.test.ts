import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("client/App.tsx", "utf-8");
const analyticsSource = readFileSync("client/lib/analytics.ts", "utf-8");
const appRootSource = readFileSync("client/AppRoot.tsx", "utf-8");
const deviceSource = readFileSync("client/lib/device.ts", "utf-8");
const indexHtml = readFileSync("client/index.html", "utf-8");
const stylesReadyAttribute = "data-ferry-fyi-styles-ready";
const viteConfigSource = readFileSync("client/vite.config.ts", "utf-8");

describe("client document loading", () => {
  it("loads analytics and native device details after the app is interactive", () => {
    expect(indexHtml).not.toContain("googletagmanager.com");
    expect(appSource).toContain("deferAnalytics");
    expect(analyticsSource).toContain('import("react-ga4")');
    expect(analyticsSource).not.toContain('import ReactGA from "react-ga4"');
    expect(deviceSource).toContain('import("@capacitor/device")');
    expect(deviceSource).not.toContain('import { Device } from "@capacitor/device"');
  });

  it("keeps SSR snapshots hidden until the complete application CSS is parsed", () => {
    expect(indexHtml).toContain(
      `html:not([${stylesReadyAttribute}])\n        #root[data-ferry-fyi-render-mode="snapshot"]`
    );
    expect(indexHtml).toMatch(
      /ferry-fyi-ssr-style-fallback 0s 5s forwards;\s*visibility: hidden;/
    );
    expect(indexHtml).toContain('<link href="/app.scss" rel="stylesheet" />');
    expect(viteConfigSource).toContain("ferry-app-styles-ready");
    expect(viteConfigSource).toContain(stylesReadyAttribute);
    expect(viteConfigSource).toContain('order: "post"');
    expect(appSource).not.toContain('import "./app.scss"');
    expect(appRootSource).not.toContain('import "./app.scss"');
  });
});
