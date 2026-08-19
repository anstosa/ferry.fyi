# Automatic leaderboard secure runtime N1

The Android N1 source boundary implements the encrypted native credential,
candidate queue, policy reconciliation, zero-data WorkManager uploader,
geofence/boot recovery adapters, and generic credited signal. It remains
compiled **off** in ordinary Debug and Release builds through
`BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED=false`. The main manifest does
not request `ACCESS_BACKGROUND_LOCATION`, does not declare a location
foreground service, and keeps the N1 receivers disabled and non-exported.
Manual foreground terminal and vessel check-in remains the available fallback.

The explicit `n1Capability` build type enables the reviewed Android capability,
adds background location and the two non-exported owned receivers, and still
declares no location foreground service. Build and gate it separately with:

Both receiver components remain disabled on a clean N1 installation. Native
region activation enables them only after one complete enrollment and config
generation commits, and stop/purge disables them again.

The platform-neutral `AutomaticLeaderboardCheckins` bridge exposes explicit
foreground and background permission actions without coordinates. Android asks
for fine foreground access first, then opens the reviewed app Settings screen
for background access; returning to enrollment rechecks the aggregate permission
state before any bootstrap nonce or credential request. Default builds and API
26–28 return a fixed inert permission result without constructing the runtime.

```sh
./gradlew testN1CapabilityUnitTest assembleN1Capability lintN1Capability
./gradlew -PautomaticAndroidTestBuildType=n1Capability connectedN1CapabilityAndroidTest
```

## Storage and lifecycle

- Enrollment credentials and candidates use independent non-exportable Android
  Keystore AES-GCM keys. One random nonce and one ciphertext file is stored for
  each candidate under `noBackupFilesDir/leaderboard-automatic/v1`.
- The authenticated owner is checked through a keyed device-only digest bound
  to the current credential. The raw Auth0 subject is transient bridge input
  and is never persisted, returned, or logged.
- Candidate, credential, and installation data is excluded from Android cloud
  backup and device transfer by both legacy and Android 12+ extraction rules.
- Candidate plaintext never enters WorkManager input, preferences, bridge
  events, notifications, logs, or filenames. WorkManager carries `Data.EMPTY`.
- Logical expiry is exactly 12 hours from server-anchored capture time. Clock
  rollback cannot extend it. Reboot or pre-first-unlock execution blocks capture
  and upload until a direct HTTPS configuration response refreshes server time.
- Final server responses delete the ciphertext before exposing a fixed outcome.
  Failed deletion enters `cleanup_required`, blocks capture/upload, and retries
  physical deletion until no candidate ciphertext remains.
- Permission loss, accuracy downgrade, identity loss, opt-out, local disable,
  enrollment revocation/expiry, account deletion, and learned policy/detector
  denial increment `localWorkGeneration`, cancel old work, unregister regions,
  ignore older callbacks, and purge queued ciphertext. Identity-ending stops
  also delete credential, queue key, and installation binding.
- A disconnected device does not infer a remote kill. It may retain unexpired
  encrypted candidates until a successful config/status contact or an
  authenticated candidate denial supplies authoritative policy.

Android force-stop cancels passive work. Automatic behavior cannot resume until
the user explicitly launches the app; that foreground opportunity refreshes
status, configuration, and server time before any region registration. Delivery
is best effort and is never described as continuous or guaranteed.

The only credited UI is the generic notification “A leaderboard check-in was
verified.” and the empty `leaderboard-checkins-changed` bridge signal. Neither
contains terminal, vessel, candidate, location, or captured-time detail.

## Validation tasks

Default-off production-like checks:

```bash
cd android
./gradlew --no-daemon testDebugUnitTest assembleDebug lintDebug
./gradlew --no-daemon connectedDebugAndroidTest
```

The V0 diagnostic remains a separate opt-in build and instrumentation target:

```bash
cd android
./gradlew --no-daemon testV0DiagnosticUnitTest assembleV0Diagnostic
./gradlew --no-daemon connectedV0DiagnosticAndroidTest
```

Physical backup/transfer, force-stop, OEM geofence delivery, permission UX,
battery, and store evidence remain release-gate work; source-level N1 completion
does not enable production flags or claim those external gates passed.
