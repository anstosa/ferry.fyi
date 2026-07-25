# Background-location feasibility surface

This Android-only Capacitor plugin is a manual feasibility aid, not a shipping
background-location feature. It is disabled in every normal build.

The committed Android manifest deliberately does **not** declare
`ACCESS_BACKGROUND_LOCATION`. Therefore normal builds neither request nor advertise
background-location access to Android or Google Play.

## Guardrail

`BuildConfig.BACKGROUND_LOCATION_FEASIBILITY_ENABLED` is `false` unless the debug build is
explicitly made with:

```sh
cd android
./gradlew :app:assembleDebug -PbackgroundLocationFeasibilityEnabled=true
```

The flag only enables the inert diagnostic surface. It does not add a background
permission to the manifest. A separately approved, non-production feasibility
configuration must supply that permission before any background authorization can
be evaluated; do not add it to the normal app manifest.

When disabled, `requestForegroundLocationPermission` and
`openBackgroundLocationSettings` return `UNAVAILABLE` and make no permission-changing call.
The plugin remains registered so a native/web diagnostic can read its disabled status.

## Hooks for a manual test build

The registered Capacitor plugin name is `BackgroundLocationFeasibility`.

- `getStatus()` returns only the build flag and permission/lifecycle state.
- `requestForegroundLocationPermission()` requests coarse/fine foreground location after the
  explicit feasibility flag is enabled.
- `openBackgroundLocationSettings()` opens the system app-settings screen only after foreground
  permission is granted. Android, rather than the app, controls the background permission choice.
- `backgroundLocationFeasibility` is a retained listener event emitted for permission/settings
  results and app resume while the feasibility flag is enabled.

The returned and emitted payloads intentionally contain no coordinates, trip identifiers,
user identifiers, or leaderboard/credit values. The implementation creates no location client,
background service, persistent store, or network request.

## Manual instrumentation

Use logcat to observe the event names without collecting location data:

```sh
adb logcat -s BgLocationFeasibility
```

For a feasibility build, verify the foreground prompt, return to the app, and inspect
`getStatus()` or the resume event. Do not treat a permission grant as evidence that
background tracking or product crediting exists.

## Default-build static check

Before shipping, verify that the normal manifest has no background-location declaration:

```sh
! grep -q 'ACCESS_BACKGROUND_LOCATION' android/app/src/main/AndroidManifest.xml
```
