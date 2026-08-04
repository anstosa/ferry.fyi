import path from "node:path";

import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createStaticPolicyRouter } from "../../server/controllers/static";

const clientDirectory = path.resolve(__dirname, "../../client");

describe("security.txt", () => {
  it("publishes a maintainable RFC 9116 contact", async () => {
    const app = express();
    app.use(createStaticPolicyRouter(clientDirectory));
    const response = await request(app)
      .get("/.well-known/security.txt")
      .expect(200)
      .expect("content-type", /text\/plain/);

    const fields = new Map(
      response.text
        .trim()
        .split("\n")
        .map((line) => line.split(/:\s+/, 2) as [string, string])
    );
    expect(fields.get("Contact")).toBe("mailto:dev@ferry.fyi");
    expect(fields.get("Canonical")).toBe(
      "https://ferry.fyi/.well-known/security.txt"
    );
    const expiresAt = Date.parse(fields.get("Expires") ?? "");
    const remaining = expiresAt - Date.now();
    expect(remaining).toBeGreaterThan(30 * 24 * 60 * 60 * 1_000);
    expect(remaining).toBeLessThan(365 * 24 * 60 * 60 * 1_000);
  });
});
