# Android internal release automation

The Android job in the `Publish apps` workflow builds a signed Android App Bundle
and uploads it only to the Google Play **Internal testing** track. It never
publishes to production.

## One-time configuration

1. Enable the Google Play Android Developer API in a Google Cloud project.
2. Create a service account, create a JSON key, and grant that account access to
   the Ferry FYI Play Console app with permission to release to Internal testing.
3. Add these repository Actions secrets:
   - `PLAY_SERVICE_ACCOUNT_JSON`: the entire service-account JSON key.
   - `ANDROID_UPLOAD_KEYSTORE_BASE64`: the upload keystore encoded as one line:
     `base64 < ferry-fyi-upload.jks | tr -d '\n'`
   - `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
   - `ANDROID_UPLOAD_KEY_ALIAS`
   - `ANDROID_UPLOAD_KEY_PASSWORD`
   - `SENTRY_AUTH_TOKEN` (recommended): a Sentry organization token with
     release artifact upload access. When present, the build uploads JavaScript
     source maps and the R8/ProGuard mapping for readable native crash reports.
4. Ensure the repository Actions variables used by the production web build are
   set: Auth0, Firebase, Mapbox, analytics, Sentry, and `BASE_URL`. The workflow
   uses the same names as `.github/workflows/deploy-aws.yml`.

The keystore must be the app's existing Play upload key. A different key cannot
update the installed Android app.

The app initializes the official Sentry Capacitor SDK with native crash
handling enabled. Release builds upload obfuscation mappings to the existing
`ferry-fyi/web` Sentry project when `SENTRY_AUTH_TOKEN` is configured;
`SENTRY_DSN` remains a repository Actions variable and the auth token remains a
secret.

Before the first advertising-enabled store build, complete the Google Play
declarations in `docs/app-store-advertising.md`. Repeat that checklist whenever
advertising selection, measurement, sharing, creative formats, or surfaces
change.

## Releasing

Use either of these triggers:

- Push a tag such as `android-v2.9`; the tag suffix becomes the Android version
  name.
- Run **Publish apps** from the Actions tab, choose **android** (or **both**),
  and enter a version name.

The workflow assigns `versionCode` as `100000 + GitHub run number`, making every
release monotonically newer than the app's current version code. It retains the
signed `.aab` as a 30-day Actions artifact and then publishes it to Internal
testing.

## Local signed build

Copy `android/keystore.properties.example` to the ignored
`android/keystore.properties`, populate it with the upload-key values, then run:

```sh
yarn build:android:release
```

To override the release version locally, pass Gradle properties after the Android
web build, for example:

```sh
cd android
./gradlew --no-daemon bundleRelease -PVERSION_CODE=100001 -PVERSION_NAME=2.9
```
