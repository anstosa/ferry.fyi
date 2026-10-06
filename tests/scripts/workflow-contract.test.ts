import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = (name: string) =>
  fs.readFileSync(
    path.resolve(__dirname, `../../.github/workflows/${name}`),
    "utf8"
  );

describe("CI workflow contract", () => {
  // ensure new source revisions cannot silently reuse the package's OTA version
  it("publishes an explicit source-versioned OTA bundle from complete history", () => {
    const publish = workflow("publish-ota.yml");

    expect(publish).toContain("fetch-depth: 0");
    expect(publish).toContain("scripts/prepareOtaRelease.ts version");
    expect(publish).toContain(
      ['--bundle "', "$", '{OTA_RELEASE_VERSION}"'].join("")
    );
    expect(publish).toContain("scripts/prepareOtaRelease.ts index");
    expect(publish).toContain(".bundle == $expected");
  });

  // preserve channel state when a restricted S3 read fails
  it("requires a provisioned OTA index instead of treating failed reads as empty", () => {
    const publish = workflow("publish-ota.yml");

    expect(publish).toMatch(
      /if ! aws s3api get-object[^\n]+; then[\s\S]*?exit 1\n\s+fi/
    );
    expect(publish).not.toContain("NoSuchKey");
    expect(publish).not.toContain(`'{"releases":[]}' > releases.json`);
  });

  // reject config changes disguised as retries of one source version
  it("verifies ZIP contents before retaining metadata for a changed-checksum retry", () => {
    const publish = workflow("publish-ota.yml");

    expect(publish).toContain("python3 scripts/compare-ota-bundles.py");
    expect(publish).toContain("sha256sum --check --status");
    expect(
      publish.indexOf("python3 scripts/compare-ota-bundles.py")
    ).toBeLessThan(publish.indexOf('export BUNDLE_CHECKSUM="'));
  });

  it("avoids duplicate branch pushes while cancelling superseded checks", () => {
    const checks = workflow("check.yml");
    expect(checks).toMatch(/pull_request:/);
    expect(checks).toMatch(/push:\n\s+branches:\n\s+- production/);
    expect(checks).toMatch(/cancel-in-progress: true/);
    expect(checks).not.toMatch(/push:\s*(?:\{\}|\n\s*$)/m);
  });

  it("runs browser checks against the exact production artifact", () => {
    const checks = workflow("check.yml");
    expect(checks).toContain("needs: build");
    expect(checks).toContain(
      ["name: production-build-", "$", "{{ github.sha }}"].join("")
    );
    expect(checks).toContain("sha256sum --check dist/artifact-files.sha256");
    expect(checks).toContain('SENTRY_AUTH_TOKEN: ""');
  });

  it("has no silent quarantine escape hatch", () => {
    const checks = workflow("check.yml");
    expect(checks).not.toContain("continue-on-error:");
    expect(checks).not.toContain("quarantine:");
  });

  // lock native setup and scan coverage
  it("uses the fixed Android setup without weakening CodeQL", () => {
    const checks = workflow("check.yml");
    const codeql = workflow("codeql.yml");
    const codeqlConfig = fs.readFileSync(
      path.resolve(__dirname, "../../.github/codeql/codeql-config.yml"),
      "utf8"
    );
    const publishAndroid = workflow("publish-android.yml");
    const setupAndroidReferences = [checks, codeql, publishAndroid].flatMap(
      // collect every Android setup action reference
      (contents) =>
        contents.match(/android-actions\/setup-android@[^\s]+/g) ?? []
    );

    expect(setupAndroidReferences).toEqual(
      Array(4).fill("android-actions/setup-android@v4.0.2")
    );
    expect(codeql).toContain("language: actions\n            build-mode: none");
    expect(codeql).toContain(
      "language: javascript-typescript\n            build-mode: none"
    );
    expect(codeql).toContain("language: python\n            build-mode: none");
    expect(codeql).toContain(
      "language: java-kotlin\n            build-mode: manual"
    );
    expect(codeql).toContain("language: swift\n            build-mode: manual");
    expect(codeql).toContain(
      ["category: /language:", "$", "{{ matrix.language }}"].join("")
    );
    expect(codeqlConfig.match(/\n\s+- exclude:/g)).toHaveLength(8);
  });

  // prevent incompatible native Sentry resolution
  it("keeps the Sentry bridge on its compatible native and browser SDKs", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
    );
    const sentryPackage = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../node_modules/@sentry/capacitor/Package.swift"
      ),
      "utf8"
    );

    expect(manifest.dependencies["@sentry/capacitor"]).toBe("4.4.0");
    expect(manifest.dependencies["@sentry/react"]).toBe("10.69.0");
    expect(sentryPackage).toContain(
      '.package(url: "https://github.com/getsentry/sentry-cocoa", exact: "9.28.0")'
    );
  });

  it("captures recovery evidence before migrations and smokes the deployed revision", () => {
    const deploy = workflow("deploy-aws.yml");
    expect(
      deploy.indexOf("Capture compatibility recovery evidence")
    ).toBeLessThan(deploy.indexOf("Run database migrations"));
    expect(deploy.indexOf("Deploy web service")).toBeLessThan(
      deploy.indexOf("Verify deployed release and public contracts")
    );
    expect(
      deploy.indexOf("Verify deployed release and public contracts")
    ).toBeLessThan(deploy.indexOf("Deploy detector service"));
    expect(deploy).toContain("deployment-recovery.json");
    expect(deploy).toContain("smoke-public-contracts.mjs");
    expect(deploy).toContain(
      "deployment action did not report the intended task definition"
    );
  });

  // keep test billing out of production
  it("rejects RevenueCat sandbox web keys during production deploys", () => {
    const deploy = workflow("deploy-aws.yml");
    expect(deploy).toContain(
      ['"', "$", "{REVENUECAT_WEB_PUBLIC_API_KEY}", '" == rcb_sb_*'].join("")
    );
    expect(deploy).toContain(
      ['"', "$", "{REVENUECAT_WEB_PUBLIC_API_KEY}", '" != rcb_*'].join("")
    );
    expect(deploy).toContain(
      "REVENUECAT_WEB_PUBLIC_API_KEY must be a production RevenueCat Billing key"
    );
  });

  // keep app store version creation explicit
  it("defaults App Store metadata updates to existing versions", () => {
    const update = workflow("update-app-store-description.yml");
    expect(update).toMatch(
      /create_version_if_missing:[\s\S]*?default: false[\s\S]*?type: boolean/
    );
  });
});
