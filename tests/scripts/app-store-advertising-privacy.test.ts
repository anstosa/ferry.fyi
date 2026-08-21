import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const androidManifest = readFileSync(
  "android/app/src/main/AndroidManifest.xml",
  "utf8"
);
const androidArchiveAssertion = readFileSync(
  "scripts/assert-android-native-build.py",
  "utf8"
);
const iosPrivacyManifest = readFileSync(
  "ios/App/App/PrivacyInfo.xcprivacy",
  "utf8"
);
const iosArchiveAssertion = readFileSync(
  "scripts/assert-ios-native-archive.py",
  "utf8"
);

describe("app store advertising privacy boundaries", () => {
  // block advertising identifiers from every merged android build
  it("removes and verifies the Google advertising ID permission", () => {
    expect(androidManifest).toContain(
      'android:name="com.google.android.gms.permission.AD_ID"'
    );
    expect(androidManifest).toContain('tools:node="remove"');
    expect(androidArchiveAssertion).toContain(
      'GOOGLE_ADVERTISING_ID_PERMISSION = "com.google.android.gms.permission.AD_ID"'
    );
    expect(androidArchiveAssertion).toContain(
      "first-party contextual ads must not request the Google advertising ID"
    );
  });

  // block cross-app tracking and tracking prompts from ios archives
  it("declares and verifies that iOS tracking is disabled", () => {
    expect(iosPrivacyManifest).toMatch(
      /<key>NSPrivacyTracking<\/key>\s*<false\/>/u
    );
    expect(iosArchiveAssertion).toContain(
      'privacy.get("NSPrivacyTracking") is False'
    );
    expect(iosArchiveAssertion).toContain(
      '"NSUserTrackingUsageDescription" not in app'
    );
  });
});
