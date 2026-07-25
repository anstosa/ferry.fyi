# Leaderboard Gate A feasibility protocol

Gate A prevents automatic leaderboard enrollment, background monitoring, credit submission, and check-in notifications from being enabled before platform-native behavior is proven.

Gate A is out of the current foreground-only rollout. Ordinary Android and iOS
builds must not declare background-location permissions or execution modes;
any future device experiment needs a separately approved non-production native
configuration.

## Safety invariants

- The feature is disabled by default.
- No leaderboard score or check-in event is created during feasibility work.
- Raw coordinates, accuracy, source timestamps, and travel traces are never written to durable storage, backups, analytics, crash reports, or logs.
- If authenticated delivery cannot happen while evidence is still in memory, discard the evidence and award no credit.
- Web/PWA support is foreground-only; it must never claim background monitoring.

## Required device evidence

Test Android and iOS separately on physical devices with an authenticated test account:

1. Enable from the leaderboard permission walkthrough; verify location and notification permission requests are contextual and separate.
2. Grant, deny, then revoke location permission; verify status changes and monitoring stops immediately when required.
3. In the separately approved non-production configuration only, verify an enabled
   native background lifecycle after foregrounding, suspending, and terminating the app.
4. Verify authenticated delivery is possible after lifecycle transitions without persisting raw evidence.
5. Test offline/failed delivery; verify evidence is discarded rather than queued durably.
6. Opt out while active and while a submission is in flight; verify monitoring stops and no later work is credited.
7. Verify notification denial does not disable monitoring, and a new check-in notification replaces an active prior one when delivery is enabled.
8. Inspect application storage, device backup settings, logs, analytics, and crash-report payloads for location-data absence.

## Pass / fail

- **Pass:** all required evidence succeeds, native builds pass, and the feature remains disabled until a later rollout decision.
- **Fail:** any lifecycle, authentication, opt-out, raw-data, or permission-revocation case fails. Keep all Gate A feature flags disabled and record the failure before reopening the architecture decision.

## Platform notes

The existing Capacitor Geolocation plugin does not provide background geolocation directly. Android and iOS therefore require native lifecycle proof; web remains foreground-only.
