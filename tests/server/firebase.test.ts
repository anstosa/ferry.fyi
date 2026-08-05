import { describe, expect, it } from "vitest";

import { parseFirebaseServiceAccount } from "../../server/lib/firebase";

const encodedAccount = (projectId: string): string =>
  Buffer.from(JSON.stringify({ project_id: projectId })).toString("base64");

describe("Firebase project identity", () => {
  it("accepts the service account used by the browser Firebase project", () => {
    expect(
      parseFirebaseServiceAccount(encodedAccount("ferry-fyi"), "ferry-fyi")
    ).toMatchObject({ project_id: "ferry-fyi" });
  });

  it("rejects a service account for a different Firebase project", () => {
    expect(() =>
      parseFirebaseServiceAccount(encodedAccount("ferry-fyi-dev"), "ferry-fyi")
    ).toThrow("does not match FIREBASE_PROJECT_ID");
  });
});
