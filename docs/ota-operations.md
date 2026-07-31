# OTA operations

This runbook covers Android and iOS web-asset updates delivered by the Capacitor updater. The updater is configured in `capacitor.config.ts` with `autoUpdate: false`; `client/entry-client.tsx` asks the server for an update at startup, downloads it in the background, and activates it on a later app start.

## Release boundaries

An OTA release contains only the web application assets. It can update React, TypeScript output, styles, and other files produced in `dist/client`.

An OTA release cannot change a native app binary. Changes to Capacitor plugins, plugin configuration, Android or iOS permissions, `android/`, `ios/`, `capacitor.config.ts`, or native code require a signed store release. Follow the Android or iOS release procedure in `README.md`; use internal testing before production rollout. Do not use OTA to distribute native/plugin/permission changes.

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
terraform output -raw ota_channel_release_base_url
terraform output -raw ota_releases_url
```

Use the outputs as follows:

| Publisher value | Terraform output |
| --- | --- |
| `OTA_BUCKET_NAME` | `ota_bucket_name` |
| `OTA_DISTRIBUTION_DOMAIN` | `ota_distribution_domain` |
| CloudFront invalidation target | `ota_distribution_id` |
| Immutable bundle URL prefix | `ota_bundle_base_url` |
| Channel JSON URL prefix | `ota_channel_release_base_url` |
| Server `OTA_RELEASES_URL` | `ota_releases_url` |

The OTA bucket is private. Publish through S3 using the GitHub OIDC deployment role or an explicitly authorized AWS identity, but put only CloudFront HTTPS URLs in release JSON. Never publish S3 website URLs or make the bucket public.

The generated CloudFront hostname uses AWS's default certificate, which AWS fixes at a TLSv1 minimum. Android clients negotiate modern TLS, but this does not enforce a TLS 1.2 minimum. Before a broad production rollout, move OTA delivery to a dedicated hostname backed by a DNS-validated ACM certificate in `us-east-1` and configure that hostname as the CloudFront alias.

## Publishing workflow

Every successful `production` deployment automatically builds and publishes a `production` OTA bundle after the web, detector, and scheduler services are stable. The publisher is idempotent for the same source revision: it verifies and reuses the existing immutable ZIP on a deployment retry.

OTA publication is deployment-owned; do not publish a bundle separately.

1. Build the Android-targeted web assets and inspect `dist/client`:

   ```sh
   NODE_ENV=production CACHE_NAME=android yarn build:client
   find dist/client -maxdepth 2 -type f | sort | sed -n '1,80p'
   ```

2. Create an immutable ZIP outside the repository. Use a unique semver version and keep the object key immutable:

   ```sh
   OTA_RELEASE_VERSION=1.2.3
   OTA_CHANNEL=staging
   mkdir -p /tmp/ferry-fyi-ota/${OTA_RELEASE_VERSION}
   (cd dist/client && zip -qr "/tmp/ferry-fyi-ota/${OTA_RELEASE_VERSION}/ferry-fyi-${OTA_RELEASE_VERSION}.zip" .)
   sha256sum "/tmp/ferry-fyi-ota/${OTA_RELEASE_VERSION}/ferry-fyi-${OTA_RELEASE_VERSION}.zip"
   ```

3. Upload the bundle to `bundles/<version>/ferry-fyi-<version>.zip`. The object must not be overwritten:

   ```sh
   aws s3 cp \
     "/tmp/ferry-fyi-ota/${OTA_RELEASE_VERSION}/ferry-fyi-${OTA_RELEASE_VERSION}.zip" \
     "s3://${OTA_BUCKET_NAME}/bundles/${OTA_RELEASE_VERSION}/ferry-fyi-${OTA_RELEASE_VERSION}.zip" \
     --region us-west-2
   ```

4. Write the channel pointer and aggregate release index locally. Each release record needs the channel, exact semver version, SHA-256 checksum, and the CloudFront bundle URL. The index may contain at most one record per channel, and the URL must have no query string or fragment:

   ```json
   {
     "releases": [
       {
         "channel": "staging",
         "version": "1.2.3",
         "checksum": "<64 lowercase hexadecimal SHA-256 characters>",
         "url": "https://<ota_distribution_domain>/bundles/1.2.3/ferry-fyi-1.2.3.zip"
       }
     ]
   }
   ```

   Keep the prior records for other channels when updating `releases.json`. A channel promotion changes only that channel's record.

5. Publish the mutable pointer and index. The path layout is defined by `infra/aws/terraform/README.md` and `infra/aws/terraform/iam-github.tf`:

   ```sh
   aws s3 cp channels/${OTA_CHANNEL}.json \
     "s3://${OTA_BUCKET_NAME}/channels/${OTA_CHANNEL}.json" \
     --content-type application/json --region us-west-2
   aws s3 cp releases.json \
     "s3://${OTA_BUCKET_NAME}/releases.json" \
     --content-type application/json --region us-west-2
   ```

6. Promote in order: `development` → `staging` → `production`. Verify the manifest endpoint and one Android and iOS device on each channel before promoting the same immutable bundle to the next channel. The server compares semver and will not downgrade an installed bundle.

7. Invalidate mutable paths when rollout must be visible before the five-minute CloudFront TTL expires:

   ```sh
   aws cloudfront create-invalidation \
     --distribution-id "${OTA_DISTRIBUTION_ID}" \
     --paths "/channels/${OTA_CHANNEL}.json" /releases.json
   ```

The IAM role is intentionally limited to `bundles/*`, `channels/*`, and `releases.json`; it does not permit deletion. Preserve immutable bundle keys and retain the checksum used in the release index.

## Cache and monitoring

- Bundles under `bundles/*` are immutable and use the one-year CloudFront cache policy. Never replace a bundle at an existing key.
- `channels/*.json` and `releases.json` use `ota_release_cache_ttl_seconds`, which defaults to five minutes and is constrained by `infra/aws/terraform/variables.tf`.
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

## Rollback

Rollback the pointer, not the immutable bundle:

1. Select the prior known-good release record for the affected channel.
2. Publish that record to `channels/<channel>.json` and update `releases.json` with the prior record.
3. Invalidate `/channels/<channel>.json` and `/releases.json` if immediate effect is required.
4. Check the manifest response and test a device that has not yet activated the bad release.

The client downloads before activation and calls `notifyAppReady` on startup. If the new bundle fails before it acknowledges readiness, Capacitor's native updater can retain or roll back to the last known-good bundle. The server also returns no update when the release index cannot be fetched or validated.

A client-side fallback cannot force an already activated bad web bundle to downgrade if the release index still advertises that same or a newer version. Restore the prior release index/pointer so new checks select the known-good release; use a higher emergency version when the affected client already activated a version that semver considers newer.

## Bundled fallback

Every signed Android and iOS app includes its web assets in the native app bundle at build time. If OTA configuration is incomplete, the device is not native, the manifest cannot be fetched, or no newer valid release exists, the app continues using the currently installed bundle. A newly installed store version therefore remains the final fallback: ship a corrected signed build through Google Play or the App Store when an OTA rollback cannot safely recover the installed client.
