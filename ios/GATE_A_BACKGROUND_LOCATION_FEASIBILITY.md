# Gate A iOS T0/V0 background-location feasibility

This is a native-only, diagnostic-only, **disabled-by-default** feasibility
slice. The committed `GateABackgroundLocationFeasibilityEnabled` value is
`false`. In an ordinary build the manager is inert, creates no
`CLLocationManager`, requests no permission, registers no regions, makes no
fleet request, and creates no diagnostic candidate.

The committed `Info.plist` deliberately has no `UIBackgroundModes=location`.
T0/V0 must first measure whether a legitimate iOS 15+ region callback can
complete one bounded location request without that capability. Adding the mode
requires a separate plan, privacy, store-review, and physical-evidence
amendment.

Release compilation hard-disables the manager even if a plist value is changed.
Only a DEBUG binary with the explicit physical-run launch argument below can
enable the harness. The harness stores only the public hash-bound terminal
configuration and its server-time/boot anchor in a protected no-backup file so
an ordinary Core Location relaunch can continue the same diagnostic run. It
stores no credential, user, fix, candidate, receipt, history, or credit data.

## Diagnostic flow

A separately reviewed DEBUG physical run passes one exact native configuration
to the AppDelegate-owned harness. JavaScript cannot enable or configure this
experiment.

1. Foreground authorization is requested before Always authorization.
2. A complete server-owned terminal generation can register fixed circular
   regions through `startMonitoring(for:)`. The manager retains every concrete
   attempted region until activation. Any failure explicitly stops pending and
   registered siblings, tombstones the identifiers, stops any late success
   callback, and makes registration terminal until process restart.
3. An owned entry callback requests exactly one location and stops after the T0
   observation.
4. An owned exit callback requests exactly one location. It then reuses a fleet
   body received less than 55 seconds ago or performs at most one credential-free
   `GET https://ferry.fyi/api/vessels/snapshot`.
5. V0 accepts only the exact ordinary API envelope
   `{wsfStatus, body: VesselSnapshot}`. Operational status requires
   `offline=false`, `warming!=true`, and `coreReady!=false`. Unknown, missing,
   duplicate, null, or wrong-type envelope/status/body fields fail as the one
   fixed `fleet_context_invalid` outcome.
6. Only canonical validated `body` bytes, their SHA-256 hash, and native
   `receivedAtMs` enter the protected no-backup fleet cache. The outer envelope
   and `wsfStatus` are neither hashed nor cached.
7. Source and receive ages are each valid from zero through 120,000 ms,
   inclusive. Future, `+1 ms`, seconds-as-milliseconds, overflow, corruption,
   network failure, and zero/ambiguous matches stop the wake with no retry.
8. A successful instrumentation build creates at most one in-memory diagnostic
   candidate, wipes its fields immediately, records one redacted fixed outcome,
   and stops.

## DEBUG physical-run harness

Do not edit `Info.plist`. In the Xcode Run action for a DEBUG build, add the
launch argument `-FerryFYIAutomaticV0Diagnostic` and the environment variable
`FERRY_FYI_V0_DIAGNOSTIC_PAYLOAD_BASE64`. The decoded JSON must have exactly
these fields:

```json
{
  "schemaVersion": 1,
  "configGeneration": 7,
  "serverPolicyGeneration": 11,
  "contentHash": "<sha256 of canonical generation-independent regions>",
  "serverTimeMs": 1720000000000,
  "regions": [
    {
      "configGeneration": 7,
      "latitudeE7": 476044000,
      "longitudeE7": -122339000,
      "radiusMillimeters": 304800,
      "terminalId": "7"
    }
  ]
}
```

Use the current reviewed server-owned region set and a current HTTPS server-time
anchor. The parser rejects unknown, duplicate, missing, wrong-type, mixed-
generation, out-of-range, over-cap, or hash-mismatched input. The harness then
requests foreground permission, requests Always permission only after the
foreground grant, installs the complete fixed set after Always authorization,
and prefetches the fleet context at the same successful setup contact.

The protected public harness record supports ordinary same-boot OS relaunch
without launch arguments. A wall-clock rollback, changed boot identity, missing
protected data, invalid record, Background App Refresh off, or permission
failure stops owned monitoring and requires manual fallback. After reboot and
first unlock, start a new explicit run with a fresh HTTPS time/config payload;
the prior boot anchor cannot authorize work.

To stop the run and unregister every `ferry-fyi-v0:` region, launch the DEBUG
binary once with `-FerryFYIAutomaticV0DiagnosticReset`. Do not combine the start
and reset arguments. The reset removes the protected public harness record.

For the separate post-swipe-away observation, manually reopen the app with the
existing protected run plus
`-FerryFYIAutomaticV0DiagnosticForceQuitRecovery`. This labels only that explicit
physical matrix row; it does not infer force quit, re-enable passive relaunch, or
enter runtime telemetry.

There is no timer, periodic background fetch, second location wake, redirect,
`/api/vessels/refresh` request, enrollment bearer, durable candidate, ciphertext
queue, upload, receipt, server-history lookup, notification, or leaderboard
credit in T0/V0. The manual check-in path is unchanged and remains the fallback.

## Truthful lifecycle limits

- **Background App Refresh off:** this is non-operational/degraded, not healthy.
  The manager stops its owned monitoring when it observes the state and requires
  manual fallback. It does not claim that avoiding `BGAppRefreshTask` makes
  region relaunch work while Background App Refresh is unavailable.
- **Authorization downgrade:** persisted owned regions are stopped before
  relaunch health, time refresh, fleet prefetch, permission recovery, or new
  registration work. Recovery starts only in a fresh explicit diagnostic run.
- **Before first unlock:** protected-data unavailability records only the fixed
  `protected_data_unavailable` outcome. No location request, cache read/write,
  candidate plaintext, or network request occurs. Foreground recovery after
  unlock must refresh time/config before future monitoring.
- **Ordinary OS termination:** a relaunch carrying the Core Location launch key
  is labeled `ordinaryRegionRelaunch` in the local physical-matrix seam.
- **Swipe-away force quit:** iOS does not passively relaunch the app for this
  flow. No callback or capture is expected until the user manually opens the
  app. A manual test harness may then label the recovery separately as
  `manualRelaunchAfterForceQuit`; the runtime never infers a force quit.

Runtime metrics contain only schema/capability version, platform cohort,
detector kind, a fixed outcome, count, and bounded duration bucket. Lifecycle,
terminal/vessel IDs, coordinates, accuracy, exact time, routes, request bodies,
free text, and credentials are excluded. Lifecycle is recorded only in the
separate redacted physical-device matrix.

## Required physical-device matrix

Run at least one iOS 15 device and devices on two newer/current stable versions,
including a modern iPhone. Keep terminal T0 and vessel V0 results separate.

1. Exercise clean install plus Allow Once, While Using, Always, Don't Allow,
   prior denial, reduced accuracy, Settings recovery, and location services off.
2. Exercise complete, at-cap, over-cap, and injected monitoring-failure region
   generations. Any failure must stop the attempted owned set and report
   degraded/manual fallback.
3. Repeat entry/exit in foreground, background, suspended, screen locked,
   ordinary OS termination/relaunch, offline, and online states. Each accepted
   callback must issue one `requestLocation()` and no timer or second wake.
4. Turn Background App Refresh off and prove non-operational/degraded status,
   stopped owned monitoring, and manual fallback. Incidental callbacks are
   observations only, never acceptance evidence.
5. Reboot before first unlock and prove zero plaintext/cache/network/candidate.
   After unlock, explicitly launch with a fresh HTTPS time/config payload and
   test only future callbacks.
6. For V0, prove the exact wrapped-snapshot, body-only cache/hash, source/receive
   age, zero-or-one transient candidate, wipe, and stop sequence. Count zero
   calls to `/api/vessels/refresh`, credential, upload, history, notification,
   and credit paths.
7. Swipe away the app and prove zero passive capture until manual open. Report
   this separately from ordinary OS termination.

Physical runs report only build, platform/OS/device class, lifecycle scenario,
detector, sample count, fixed outcomes, bounded delay/accuracy/battery buckets,
and confidence intervals. They do not contain exact locations, routes, event
times, subject, candidate, terminal, vessel, or sailing identifiers.

## Local static and Xcode validation

The Linux repository host cannot run Xcode. Before handoff, validate project
membership and plist invariants locally, then run the Xcode commands on macOS:

```sh
python3 - <<'PY'
import plistlib
from pathlib import Path

plist = plistlib.loads(Path("ios/App/App/Info.plist").read_bytes())
assert plist["GateABackgroundLocationFeasibilityEnabled"] is False
assert "location" not in plist.get("UIBackgroundModes", [])
PY

rg -n '#if DEBUG|prepareDiagnosticHarnessAtLaunch|reconcileDiagnosticHarnessIfEnabled' \
  ios/App/App/AppDelegate.swift ios/App/App/GateABackgroundLocationFeasibility.swift

rg -n 'return false' ios/App/App/GateABackgroundLocationFeasibility.swift

rg 'LeaderboardAutomaticV0Diagnostic.swift in Sources' \
  'ios/App/Ferry FYI.xcodeproj/project.pbxproj'

xcodebuild -project "ios/App/Ferry FYI.xcodeproj" \
  -scheme "Ferry FYI" \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=<available device>' \
  test

xcodebuild -project "ios/App/Ferry FYI.xcodeproj" \
  -scheme "Ferry FYI" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  -archivePath /tmp/FerryFYI.xcarchive \
  archive
```
