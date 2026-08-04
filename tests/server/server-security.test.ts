import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyHttpCache,
  DISCOVERY_CACHE_CONTROL,
  httpCachePolicy,
} from "../../server/lib/httpCachePolicy";
import {
  buildCspReportOnlyPolicy,
  createHttpSecurityMiddleware,
} from "../../server/lib/httpSecurity";
import { createApp } from "../../server/server";

afterEach(() => vi.unstubAllEnvs());

describe("server security boundary", () => {
  it("removes framework disclosure and emits stable baseline headers", async () => {
    const handler = express
      .Router()
      .get("/", (_request, response) => response.send("ok"));
    const response = await request(
      createApp({ apiHandler: handler, staticHandler: handler })
    )
      .get("/")
      .expect(200);

    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["permissions-policy"]).toContain("camera=(self)");
  });

  it("uses HSTS only for production HTTPS and does not preload subdomains", async () => {
    const app = express();
    app.use(createHttpSecurityMiddleware({ environment: "production" }));
    app.get("/", (_request, response) => response.send("ok"));

    const insecure = await request(app).get("/").expect(200);
    expect(insecure.headers["strict-transport-security"]).toBeUndefined();

    const secure = await request(app)
      .get("/")
      .set("x-forwarded-proto", "https")
      .expect(200);
    expect(secure.headers["strict-transport-security"]).toBe(
      "max-age=15552000"
    );
    expect(secure.headers["strict-transport-security"]).not.toContain(
      "includeSubDomains"
    );
    expect(secure.headers["strict-transport-security"]).not.toContain(
      "preload"
    );
  });

  it("keeps production CSP report-only conditional on a safe collector", async () => {
    const withoutCollector = express();
    withoutCollector.use(
      createHttpSecurityMiddleware({ environment: "production" })
    );
    withoutCollector.get("/", (_request, response) => response.send("ok"));
    expect(
      (await request(withoutCollector).get("/")).headers[
        "content-security-policy-report-only"
      ]
    ).toBeUndefined();

    const withCollector = express();
    withCollector.use(
      createHttpSecurityMiddleware({
        environment: "production",
        reportUri: "https://reports.ferry.fyi/csp",
      })
    );
    withCollector.get("/", (_request, response) => response.send("ok"));
    expect(
      (await request(withCollector).get("/")).headers[
        "content-security-policy-report-only"
      ]
    ).toContain("report-uri https://reports.ferry.fyi/csp");
    expect(buildCspReportOnlyPolicy()).toContain("frame-ancestors 'none'");
  });
});

describe("HTTP cache policy", () => {
  it("classifies discovery, live API, OTA, and route-owned responses", () => {
    expect(classifyHttpCache("/robots.txt")).toBe("discovery");
    expect(classifyHttpCache("/api/features")).toBe("live");
    expect(classifyHttpCache("/api/ota/channel")).toBe("route-owned");
    expect(classifyHttpCache("/about")).toBe("route-owned");
  });

  it("gives discovery documents bounded cache headers and validators", async () => {
    const app = express();
    app.set("etag", "strong");
    app.use(httpCachePolicy);
    app.get("/robots.txt", (_request, response) =>
      response.type("text/plain").send("User-agent: *")
    );

    const first = await request(app).get("/robots.txt").expect(200);
    expect(first.headers["cache-control"]).toBe(DISCOVERY_CACHE_CONTROL);
    expect(first.headers.etag).toBeTruthy();
    await request(app)
      .get("/robots.txt")
      .set("If-None-Match", first.headers.etag)
      .expect(304);
  });

  it("keeps live API responses no-store", async () => {
    const app = express();
    app.use(httpCachePolicy);
    app.get("/api/features", (_request, response) => response.json({}));
    expect(
      (await request(app).get("/api/features")).headers["cache-control"]
    ).toBe("no-store");
  });
});
