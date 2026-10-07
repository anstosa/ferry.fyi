# OTA operations

This runbook covers Android and iOS web-asset updates delivered by the Capacitor updater. The updater is configured in `capacitor.config.ts` with `autoUpdate: false`; the app shell's `OtaUpdatePrompt` asks the server for an update at startup and downloads it in the background.

A non-dismissable bottom notice shows native download progress. The reload button appears only after the complete bundle is queued successfully; choosing **Reload to apply** uses the native updater's pending-aware `reload()` to activate and clear the queued bundle before restarting the WebView. The queued bundle can also activate on a later background/restart. Already queued pending bundles restore the ready notice only when the configured channel's manifest still offers that version. Download and activation failures keep retry actions visible instead of silently claiming completion. The notice respects the schedule footer and device safe area; ordinary error/warning toasts remain visible above it rather than being suppressed.

The manifest check controls new downloads and explicit apply prompts; it does not revoke a bundle already queued in native storage. Such a bundle can still activate on background/restart under the existing native updater policy.

**OTA Built-in** identifies the assets packaged in the signed native app, not download progress. It remains correct until an OTA activates. If it persists after a ready update is applied, check native download/install and rollback logs; a bundle that does not acknowledge readiness can roll back to the built-in fallback. A publication or process restart alone does not prove installation.

## Release boundaries

An OTA release contains only the web application assets. It can update React, TypeScript output, styles, and other files produced in `dist/client`.

An OTA release cannot change a native app binary. Changes to Capacitor plugins, plugin configuration, Android or iOS permissions, `android/`, `ios/`, `capacitor.config.ts`, or native code require a signed store release. Follow the Android or iOS release procedure in `README.md`; use internal testing before production rollout. Do not use OTA to distribute native/plugin/permission changes.

Ferry FYI Supporter checkout is capability-gated at runtime. OTA bundles may
update its shared purchase UI only after the installed signed shell already
contains the RevenueCat Capacitor plugin. Older shells remain on the free app
experience and never receive a web-checkout workaround inside the native app.

## Native store updates

Signed Android and iOS builds check their platform store for a newer native
binary after the browser application mounts and when an app session returns to
the foreground. A reported update displays a dismissible Ferry FYI prompt whose
action opens Google Play or the App Store. Android treats both Play's available
and in-progress states as actionable when the reported version code is newer.
Dismissal suppresses the same store version for 24 hours; a later version is
eligible immediately. Store lookup and launch failures are non-fatal.

The initial implementation intentionally does not start Android flexible or
immediate in-app update flows. Those flows require additional download,
restart, cancellation, and interrupted-update recovery UX. Test Android update
availability through a Play testing track or Internal App Sharing with a
higher published version code; a sideloaded APK cannot validate Play update
behavior. Validate iOS lookup and App Store navigation on a physical device
against the live App Store listing. TestFlight-only builds may not have a newer
public App Store version to report. Apple's public lookup API exposes the App
Store marketing version, not TestFlight build numbers, so TestFlight owns
same-version build update prompts; Ferry FYI's prompt applies to public App
Store version changes.

## Configuration

Use only these channels, defined in `shared/contracts/ota.ts`:

- `development`
- `staging`
- `production`

### Client build variables

Set these when building the web assets consumed by the native apps:

| Variable | Required value |
| --- | --- |
| `VITE_OTA_CHANNEL` | One of `development`, `staging`, or `production`. |
| `VITE_OTA_MANIFEST_URL` | An HTTPS URL, normally `https://ferry.fyi/api/ota/manifest`. |

The client disables OTA when either variable is missing or invalid. The manifest URL is a server endpoint, not the S3 or CloudFront release-index URL.

Build the native web assets with the repository command for the platform being tested:

```sh
yarn build:android
```

That Android command runs `scripts/with-android-env.sh`, builds with `NODE_ENV=production CACHE_NAME=android`, and runs Capacitor sync. Use `yarn build:ios` for the corresponding iOS build. For an OTA-only asset build, use the existing client build command instead:

```sh
NODE_ENV=production CACHE_NAME=android yarn build:client
```

The resulting web assets are in `dist/client`. Do not commit generated Android, iOS, or `dist/` output as part of an OTA publication.

### Server variables

Terraform injects these into the ECS web task when it applies the OTA stack:

| Variable | Purpose |
| --- | --- |
| `OTA_RELEASES_URL` | Terraform-generated HTTPS URL for `releases.json`. |
| `OTA_RELEASES_BUCKET` | Private S3 bucket used by the ECS task role to read `releases.json` without NAT egress. |
| `OTA_DEFAULT_CHANNEL` | Fallback channel when a manifest request has no `defaultChannel`; set `ota_default_channel` in Terraform to one of the three channels above. |

The API route is `POST /api/ota/manifest`. The server validates the release index and keeps it in memory for five minutes. If the index is unavailable, invalid, or has no newer release, it returns a safe no-update response.

## AWS setup and outputs

The production Terraform stack is in `infra/aws/terraform`. Review the plan before applying infrastructure:

```sh
cd infra/aws/terraform
terraform init
terraform plan -out tfplan
terraform apply tfplan
```

The example production inputs are in `infra/aws/terraform/terraform.tfvars.example`. The approved region is `us-west-2`; the default mutable release cache TTL is 300 seconds and the immutable bundle cache TTL is one year.

After apply, capture the outputs without exposing sensitive state:

```sh
terraform output -raw ota_bucket_name
terraform output -raw ota_distribution_domain
terraform output -raw ota_distribution_id
terraform output -raw ota_bundle_base_url
terraform output -raw ota_releases_url
```

Use the outputs as follows:

| Publisher value | Terraform output |
| --- | --- |
| `OTA_BUCKET_NAME` | `ota_bucket_name` |
| `OTA_DISTRIBUTION_DOMAIN` | `ota_distribution_domain` |
| CloudFront invalidation target | `ota_distribution_id` |
| Immutable bundle URL prefix | `ota_bundle_base_url` |
| Server `OTA_RELEASES_URL` | `ota_releases_url` |

The OTA bucket is private. Publish through S3 using the GitHub OIDC deployment role or an explicitly authorized AWS identity, but put only CloudFront HTTPS URLs in release JSON. Never publish S3 website URLs or make the bucket public.

The generated CloudFront hostname uses AWS's default certificate, which AWS fixes at a TLSv1 minimum. Android clients negotiate modern TLS, but this does not enforce a TLS 1.2 minimum. Before a broad production rollout, move OTA delivery to a dedicated hostname backed by a DNS-validated ACM certificate in `us-east-1` and configure that hostname as the CloudFront alias.

## Publishing workflow

Every successful `production` deployment automatically builds and publishes a `production` OTA bundle after the combined web/scheduler service and detector service are stable. OTA publication is deployment-owned; do not publish a bundle separately.

### Bundle version identity

The publisher checks out complete Git history and runs `server/scripts/prepareOtaRelease.ts version`. The OTA version uses the package's major/minor components and adds the complete source-history count to its patch component. For example, package `2.5.1` at source count `100` produces OTA `2.5.101`; the next descendant produces `2.5.102`. This is an independent web-asset version, not a change to the requested native store version.

The version is passed explicitly to Capgo's `bundle zip --bundle` command. Never rely on the CLI's package-version default: publishing different ZIPs as the same semantic version makes installed devices report no update. Build metadata such as `+<sha>` does not advance semantic-version precedence either.

The publisher refuses shallow history and unsafe version counts. Keep production history forward-moving; a history rewrite or package-version regression must not silently lower a channel's OTA version. The release-index guard rejects equal or older versions from different source revisions.

### Immutable publication and retries

Bundle keys bind the OTA version, full source SHA and SHA-256 checksum:

```text
bundles/<version>/ferry-fyi-<version>-<source-sha>-<checksum>.zip
```

The publisher uses the exact ZIP path and checksum returned by Capgo and checks that its reported bundle version matches the requested version. Existing immutable objects are checksum-verified before reuse.

`server/scripts/prepareOtaRelease.ts index` validates the existing aggregate index, preserves other channels and permits only increasing channel versions. A retry of the same source and version retains its original immutable pointer only after verifying the prior ZIP checksum and comparing exact archive member paths and content hashes. ZIP timestamp or ordering changes are ignored; changed assets or configuration fail publication and require a new source revision/version. The pure index helper accepts only exact metadata reuse after this comparison. Every failed index read stops publication. A new environment requires an explicitly authorized initialization of `releases.json` containing `{"releases":[]}` before its first deployment; never overwrite an existing index during initialization. The restricted publisher role cannot distinguish a missing key from a denied read because it does not have bucket-list permission. The workflow publishes `releases.json` with no-cache semantics and invalidates that CloudFront path. It does not depend on `channels/*.json` pointers.

The IAM role is intentionally limited to `bundles/*`, `channels/*`, and `releases.json`; it does not permit deletion. Preserve immutable bundle keys and retain the checksum used in the release index.

### Local validation without publication

```sh
(cd server && node ../scripts/register-esbuild.js scripts/prepareOtaRelease.ts version)
yarn test tests/server/ota-publication.test.ts tests/server/ota-manifest.test.ts tests/scripts/workflow-contract.test.ts
```

After an authorized deployment, test the production manifest with both Android and iOS requests reporting the previously installed OTA version as `version_name`. A newly generated bundle must be offered to devices reporting the old version (including the formerly reused `2.5.1`), while devices reporting the new version receive `up_to_date`. Verify downloading and activation on a physical device; successful publication alone does not prove installation.

## Cache and monitoring

- Bundles under `bundles/*` are immutable and use the one-year CloudFront cache policy. Never replace a bundle at an existing key.
- `releases.json` uses `ota_release_cache_ttl_seconds`, which defaults to five minutes and is constrained by `infra/aws/terraform/variables.tf`.
- The server separately caches a validated `OTA_RELEASES_URL` response for five minutes in `server/lib/ota.ts`.
- Check the public release index and manifest route after publication:

  ```sh
  curl -fsS "${OTA_RELEASES_URL}"
  curl -fsS -X POST https://ferry.fyi/api/ota/manifest \
    -H 'content-type: application/json' \
    --data '{"app_id":"fyi.ferry","device_id":"ops-check","is_emulator":true,"is_prod":true,"platform":"android","plugin_version":"8","version_build":"builtin","version_code":"0","version_name":"builtin","version_os":"Android","defaultChannel":"staging"}'
  ```

- Confirm the response contains the expected HTTPS bundle URL, version, and checksum. A no-update response is expected when the installed version is current.
- Monitor the application/API logs for repeated OTA manifest failures and use the existing `/healthz` endpoint to confirm the deployed service remains healthy. OTA failures deliberately preserve the last known-good bundle.

### Recent changes missing from the app

A pushed commit is not a published OTA release. Check the matching `Deploy AWS
Production` run first: every validation and deployment gate must pass before
`Publish production OTA` can run. If an earlier step fails, the app correctly
continues to receive the previous release.

For a `Client asset budget exceeded` failure, rebuild with the deployment's
client configuration and run `yarn budget:client`. The full public-content
allocation permits 5,300,000 aggregate core JavaScript bytes; the separate
CSS, chunk-count, largest-chunk, and optional-billing limits remain unchanged.
Only adjust an allocation for measured, intentional feature growth; do not
remove the budget gate or publish an OTA separately to bypass a failed deploy.

After a successful OTA publication, compare the source SHA in the manifest's
immutable bundle URL with the intended deployment. An older SHA indicates that
the expected release has not reached the manifest; repeated app restarts cannot
install a bundle that has not been published.

## Rollback

OTA pointer recovery is separate from ECS web/task-definition and detector
recovery. For migration-aware application rollback boundaries and the required
deployment recovery artifact, also follow
`docs/reliability-operations.md#incident-triage-and-recovery`.

Rollback the pointer, not the immutable bundle:

1. Select the prior known-good release record for the affected channel.
2. Replace only the affected channel's record in `releases.json` with the prior record, preserving all other channels.
3. Invalidate `/releases.json` if immediate effect is required.
4. Check the manifest response and test a device that has not yet activated the bad release.

The client downloads before activation and calls `notifyAppReady` on startup. If the new bundle fails before it acknowledges readiness, Capacitor's native updater can retain or roll back to the last known-good bundle. The server also returns no update when the release index cannot be fetched or validated.

A client-side fallback cannot force an already activated bad web bundle to downgrade if the release index still advertises that same or a newer version. Restore the prior release index/pointer so new checks select the known-good release; use a higher emergency version when the affected client already activated a version that semver considers newer.

## Bundled fallback

Every signed Android and iOS app includes its web assets in the native app bundle at build time. If OTA configuration is incomplete, the device is not native, the manifest cannot be fetched, or no newer valid release exists, the app continues using the currently installed bundle. A newly installed store version therefore remains the final fallback: ship a corrected signed build through Google Play or the App Store when an OTA rollback cannot safely recover the installed client.
