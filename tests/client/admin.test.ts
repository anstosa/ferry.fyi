import { describe, expect, it } from "vitest";

import { confirmationPhrase } from "../../client/lib/adminConfirmation";

describe("owner admin confirmations", () => {
  it("uses the exact action and canonical target sent to the owner API", () => {
    expect(confirmationPhrase("delete-user-data", "user:auth0|person")).toBe(
      "CONFIRM delete-user-data user:auth0|person"
    );
  });

  it("keeps operation confirmations bound to the selected operation", () => {
    expect(
      confirmationPhrase("clear-cache", "operation:clear-wsf-memory-cache")
    ).toBe("CONFIRM clear-cache operation:clear-wsf-memory-cache");
  });
});
