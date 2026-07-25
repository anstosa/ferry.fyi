# Gate A iOS background-location feasibility

This is a native-only, **disabled-by-default** foundation. The committed
`GateABackgroundLocationFeasibilityEnabled` `Info.plist` value is `false`.
While false, the lifecycle hooks are inert, no `CLLocationManager` is created,
and the app cannot show a Gate A permission prompt.

The committed `Info.plist` deliberately contains no `UIBackgroundModes` `location`
capability. Consequently, ordinary builds neither advertise nor receive the iOS
background-location execution mode.

## Boundaries

- `GateABackgroundLocationFeasibility` has no location-update delegate and never
  calls `startUpdatingLocation`, significant-change monitoring, or region monitoring.
- It does not persist, transmit, log, or expose raw coordinates.
- It does not issue leaderboard credit or call any app, server, or web-layer API.
- Turning the flag on alone does not add a background capability or start tracking.
  A separately approved, non-production Xcode configuration must add the `location`
  background mode and any required privacy usage descriptions for a device experiment.
  Do not add those capabilities to the ordinary app configuration.
- `requestBackgroundAuthorizationIfEnabled()` is the sole authorization entry
  point and is not invoked from `AppDelegate`; any caller needs separate privacy,
  product, and App Review approval.

## Required validation before enabling the flag

1. Keep the default build test: launch on a clean device/simulator and confirm
   no location permission prompt appears; background/foreground the app and
   verify no location indicator is shown.
2. In a dedicated, non-production test configuration that sets the flag to
   `true`, exercise the explicit authorization method on a physical iOS 15+
   device. Test each authorization outcome: Allow Once, While Using, Always,
   Don't Allow, and a previously denied permission.
3. With the test configuration enabled, background and foreground the app both
   before and after the authorization prompt. Confirm lifecycle hooks neither
   start a location service nor generate any network request, persistence entry,
   analytics event, leaderboard change, or raw-coordinate log.
4. Inspect the app privacy manifest / App Store submission disclosure and obtain
   privacy and product approval before adding any actual location collection.
5. Run an Xcode build for the `Ferry FYI` scheme and its relevant device tests;
   this repository's Linux environment cannot execute an iOS simulator build.

## Default-build static check

Before shipping, verify that the normal plist has no background execution mode:

```sh
! grep -q 'UIBackgroundModes' ios/App/App/Info.plist
```
