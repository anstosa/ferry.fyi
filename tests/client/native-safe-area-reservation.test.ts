import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const footerSource = readFileSync("client/components/Footer.tsx", "utf-8");
const headerSource = readFileSync("client/views/Header.tsx", "utf-8");
const loadingSource = readFileSync(
  "client/components/RouteLoadingState.tsx",
  "utf-8"
);

// native inset reservation contract
describe("native safe-area reservations", () => {
  // header spacer contract
  it("prevents the Android top inset spacer from shrinking", () => {
    expect(headerSource).toContain("h-safe-top w-full flex-shrink-0");
    expect(loadingSource).toContain("h-safe-top flex-shrink-0 bg-green-dark");
  });

  // footer spacer contract
  it("prevents the Android bottom inset spacer from shrinking", () => {
    expect(footerSource).toContain("h-safe-bottom w-full flex-shrink-0");
  });
});
