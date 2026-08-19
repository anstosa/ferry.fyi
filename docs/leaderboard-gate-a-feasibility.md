# Leaderboard Gate A feasibility protocol

Gate A prevents automatic leaderboard enrollment, background monitoring, credit submission, and check-in notifications from being enabled before platform-native behavior is proven.

G008 supplies default-off source implementations and explicit Android/iOS N1
test configurations. G009 supplies the explicit user enrollment transaction.
Ordinary Debug/Release production behavior remains off. G010 still owns physical
device, OEM, backup/transfer, force-stop/force-quit, battery, and App Store/Play
evidence before any production flag decision.

## Safety invariants

- The feature is disabled by default.
- No leaderboard score or check-in event is created during feasibility work.
- Raw candidate fields may exist only inside the reviewed device-only encrypted queue. They become ineligible exactly 12 hours after capture, are never uploaded after expiry, and are physically removed at the next eligible operating-system execution. They are excluded from backup and never enter JavaScript, analytics, crash reports, or logs.
- If authenticated delivery cannot finish before trusted expiry, delete the ciphertext locally and award no credit.
- Web/PWA support is foreground-only; it must never claim background monitoring.
- The native capability floor is Android 10/API 29 or newer and iOS 15 or newer; unsupported devices remain inert before disclosure and permissions.

## Required device evidence

Test Android and iOS separately on physical devices with an authenticated test account:

1. Enable from the leaderboard permission walkthrough; verify location and notification permission requests are contextual and separate.
2. Grant, deny, then revoke location permission; verify status changes and monitoring stops immediately when required.
3. In the separately approved non-production configuration only, verify an enabled
   native background lifecycle after foregrounding, suspending, and terminating the app.
4. Verify authenticated delivery is possible after lifecycle transitions with one device-only encrypted candidate record and no JavaScript exposure.
5. Test offline/failed delivery; verify bounded encrypted retention, oldest-first retry, exact final deletion, and inclusive expiry deletion.
6. Opt out while active and while a submission is in flight; verify monitoring stops and no later work is credited.
7. Verify notification denial does not disable monitoring, and a new check-in notification replaces an active prior one when delivery is enabled.
8. Inspect application storage, device backup settings, logs, analytics, and crash-report payloads for location-data absence.

## Pass / fail

- **Pass:** all required evidence succeeds, native builds pass, and the feature remains disabled until a later rollout decision.
- **Fail:** any lifecycle, authentication, opt-out, raw-data, or permission-revocation case fails. Keep all Gate A feature flags disabled and record the failure before reopening the architecture decision.

## Platform notes

The Capacitor Geolocation plugin does not provide the required background
lifecycle. The reviewed app-local native plugin owns permission guidance,
regions, device-only credentials, encrypted queues, WorkManager/Core Location
recovery, and detail-free status. Web remains manual foreground-only.
