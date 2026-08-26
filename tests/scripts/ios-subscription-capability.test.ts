import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const iosProject = readFileSync(
  "ios/App/Ferry FYI.xcodeproj/project.pbxproj",
  "utf8"
);

describe("iOS subscription capability", () => {
  // keep storekit purchases enabled on the app target
  it("declares the in-app purchase system capability", () => {
    expect(iosProject).toMatch(
      /504EC3031FED79650016851F = \{[\s\S]*?SystemCapabilities = \{[\s\S]*?com\.apple\.InAppPurchase = \{\s*enabled = 1;\s*\};/u
    );
  });
});
