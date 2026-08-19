# Automatic leaderboard Android V0 diagnostic

This document describes the bounded Android diagnostic for the vessel-candidate V0 gate. It is not a production automatic check-in implementation and does not authorize release enablement.

## Build boundary

- The ordinary `debug` and `release` variants hard-code the V0 diagnostic off. Only the explicitly selected `v0Diagnostic` build type enables it.
- Android API 26-28 always reports `unsupported_os`; it performs no automatic permission request, native configuration or bearer read, region/work registration, durable queue write, network upload, notification, or credit action. Manual foreground check-in remains available.
- API 29+ enters the diagnostic path only in an explicitly opted-in diagnostic build.
- The base production manifest intentionally has no `ACCESS_BACKGROUND_LOCATION` and no enabled production background receiver or service; its automatic receivers are disabled and non-exported. V0 adds no foreground location service.

## Bounded callback contract

`AutomaticV0TerminalExitAdapter` forwards one named terminal-exit callback to `AutomaticV0DiagnosticRunner`. One run:

1. checks the API floor and diagnostic build flag before touching automatic material;
2. requests at most one injected location fix;
3. evaluates exactly one fleet context;
4. uses only unauthenticated `GET /api/vessels/snapshot` from the injected trusted HTTPS origin;
5. accepts only the strict ordinary-API wrapper `{wsfStatus, body}` with operational WSF status and a complete valid `VesselSnapshot` body;
6. constructs zero or one instrumentation-only candidate in a mutable in-memory slot;
7. overwrites every slot field, verifies the slot is empty, records one fixed redacted aggregate outcome, and stops.

The JVM cannot promise compiler/runtime zeroization of registers or copied immutable inputs. The implementation therefore avoids retaining an immutable candidate object, copies candidate fields into one mutable slot, overwrites that slot before the wipe probe, and never serializes or returns candidate content.

There is no retry, timer, second wake, JavaScript bridge, `/api/vessels/refresh` call, enrollment bearer, candidate queue, upload, receipt, history lookup, notification, or credit path in this slice.

The strict body schema follows the normalized public wire: nullish optional vessel fields are omitted, `yearRebuilt` is optional but finite when present, and only the two documented GPS delay signals may be explicit nulls.

## Fleet cache

- Receive age below 55 seconds reuses cache; equality refreshes once.
- A callback performs at most one named snapshot GET when cache is absent or old.
- Source and receive ages both use the provisional inclusive `0..120000ms` V0 bound.
- Only canonical validated `body` bytes, their SHA-256 hash, and a fresh post-response trusted `receivedAtMs` sample are stored in the supplied `noBackupFilesDir` cache file.
- The WSF wrapper, enrollment/user state, credentials, fixes, and candidates are never stored there.
- Replacement requires a same-directory atomic move. Unsupported atomic replacement fails closed.

## Evidence status

Host JVM tests cover the strict wrapper table, cache hash/corruption behavior, exact freshness and refresh boundaries, endpoint restriction, unsupported/default-off paths, bounded success, ambiguity, and zero forbidden surfaces. The packaged-manifest assertion is under Android instrumentation tests.

The diagnostic variant includes an instrumentation-only physical control surface; no JavaScript or production activity invokes registration. It supplies one HTTPS-derived server-time anchor plus one complete operator-supplied fixed region generation, performs the due prefetch, registers/unregisters the owned namespace, and exposes only a fixed redacted readiness status. After installing the generated app and test APKs, grant foreground/background location to the test device and run:

```bash
adb shell am instrument -w \
  -e class fyi.ferry.leaderboards.AutomaticV0PhysicalHarnessTest#installConfiguredDiagnostic \
  -e terminalId '<terminal-id>' \
  -e latitudeE7 '<scaled-latitude>' \
  -e longitudeE7 '<scaled-longitude>' \
  -e radiusMillimeters '<radius-mm>' \
  fyi.ferry.test/androidx.test.runner.AndroidJUnitRunner
```

The harness obtains a direct HTTPS server-date anchor, verifies a complete canonical configuration generation, runs the required due fleet prefetch, and atomically registers the fixed ENTER/EXIT region generation. Moving through the boundary then exercises T0 entry and V0 exit in the non-exported native receiver. Check the fixed readiness status with:

```bash
adb shell am instrument -w \
  -e class fyi.ferry.leaderboards.AutomaticV0PhysicalHarnessTest#statusConfiguredDiagnostic \
  -e status true \
  fyi.ferry.test/androidx.test.runner.AndroidJUnitRunner
```

The status command reports success only when the supported diagnostic build has both location grants, a same-boot trusted time anchor, a validated fleet cache, and a successful redacted registration marker. Remove the diagnostic registration with:

```bash
adb shell am instrument -w \
  -e class fyi.ferry.leaderboards.AutomaticV0PhysicalHarnessTest#removeConfiguredDiagnostic \
  -e cleanup true \
  fyi.ferry.test/androidx.test.runner.AndroidJUnitRunner
```

Physical-device evidence remains required before V0 can pass. Run the approved matrix separately on API 26-28 emulators and supported Pixel and Samsung hardware covering Android 10/API 29, Android 11+ Settings authorization, Android 15 force-stop, and the latest stable OS. Include foreground, background, screen-off, ordinary process death, reboot, and force-stop cells, with five repeated legitimate attempts plus the negative cases per required cell. Battery characterization requires at least three paired randomized feature-off versus diagnostic runs per device/scenario. Publish only redacted counts, fixed outcomes, delay/accuracy/duration buckets, battery observations, and confidence bounds. Do not publish terminal/vessel IDs, routes, coordinates, accuracy values, exact event times, credentials, candidate data, or request bodies.
