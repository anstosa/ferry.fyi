import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("client/App.tsx", "utf-8");
const analyticsSource = readFileSync("client/lib/analytics.ts", "utf-8");
const deviceSource = readFileSync("client/lib/device.ts", "utf-8");
const indexHtml = readFileSync("client/index.html", "utf-8");

describe("deferred non-critical scripts", () => {
  it("loads analytics and native device details after the app is interactive", () => {
    expect(indexHtml).not.toContain("googletagmanager.com");
    expect(appSource).toContain("deferAnalytics");
    expect(analyticsSource).toContain('import("react-ga4")');
    expect(analyticsSource).not.toContain('import ReactGA from "react-ga4"');
    expect(deviceSource).toContain('import("@capacitor/device")');
    expect(deviceSource).not.toContain('import { Device } from "@capacitor/device"');
  });
});
