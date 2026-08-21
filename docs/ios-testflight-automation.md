# iOS TestFlight release automation

The iOS job in the `Publish apps` workflow builds a signed IPA and uploads it to
App Store Connect for TestFlight. It never submits an App Store release for
review or publishes directly to customers.

## One-time configuration

1. Create the `fyi.ferry` App ID and an App Store Connect app record.
2. Create an **App Store Connect API key** with the App Manager role or higher.
3. Create an Apple Distribution certificate and an App Store provisioning
   profile for `fyi.ferry`.
4. Add these repository Actions secrets:
   - `APP_STORE_CONNECT_API_KEY_BASE64`: the `.p8` API key encoded as one line:
     `base64 < AuthKey_<KEY_ID>.p8 | tr -d '\n'`
   - `APP_STORE_CONNECT_API_KEY_ID`: the API key ID.
   - `APP_STORE_CONNECT_ISSUER_ID`: the API issuer ID.
   - `IOS_DEVELOPMENT_TEAM_ID`: the Apple Developer team ID.
   - `IOS_DISTRIBUTION_CERTIFICATE_BASE64`: the `.p12` distribution certificate
     encoded as one line: `base64 < distribution.p12 | tr -d '\n'`
   - `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`: the `.p12` export password.
   - `IOS_PROVISIONING_PROFILE_BASE64`: the App Store profile encoded as one
     line: `base64 < ferry-fyi.mobileprovision | tr -d '\n'`
   - `SENTRY_AUTH_TOKEN` (recommended): a Sentry organization token with
     release artifact upload access. When present, the build uploads JavaScript
     source maps and the archive's dSYMs for readable native crash reports.
5. Ensure the repository Actions variables used by the production web build are
   set, including Auth0, Firebase, Mapbox, analytics, Sentry, and `BASE_URL`.

The distribution certificate and profile must belong to the same Apple
Developer team and profile the `fyi.ferry` App ID. Never store the `.p8`,
`.p12`, profile, or passwords in Git.

The app initializes the official Sentry Capacitor SDK with native crash and app
hang reporting enabled. TestFlight builds upload dSYMs to the existing
`ferry-fyi/web` Sentry project when `SENTRY_AUTH_TOKEN` is configured;
`SENTRY_DSN` remains a repository Actions variable and the auth token remains a
secret.

Before the first advertising-enabled store build, complete the App Store
Connect declarations in `docs/app-store-advertising.md`. Repeat that checklist
whenever advertising selection, measurement, sharing, creative formats, or
surfaces change.

## Releasing

Use either trigger:

- Push a tag such as `ios-v1.0`; the tag suffix becomes the iOS version.
- Run **Publish apps** from the Actions tab, choose **ios** (or **both**), and enter a version name.

The workflow uses `100000 + GitHub run number` as its build number, so each
TestFlight upload is monotonically newer. It retains the signed IPA as a
30-day Actions artifact, then uploads it to App Store Connect. Apple still
processes the build before it appears in TestFlight.

## First release

After Apple processes the first build, add internal TestFlight testers in App
Store Connect. External TestFlight testers require Beta App Review. A public
release remains a separate, manual App Store Connect submission with product
metadata, privacy information, screenshots, review notes, and the selected
processed build.
