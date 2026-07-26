# Leaderboards

Leaderboards use a DB-backed `leaderboards` feature flag. Public pages and
public ranking APIs require the global enabled state and are disabled by a kill
switch. Authenticated leaderboard/check-in requests can additionally admit a
normalized Auth0 subject allowlist while the global flag is off; a kill switch
still wins. The anonymous `/api/features` endpoint reports only global public
decisions, while authenticated clients use `/api/features/me`. There is no
percentage rollout or expiry. Automatic/background check-ins are permanently
disabled and cannot be enabled through an admin control. The server uses the
pinned `server/data/noaa-enc-harbour-puget-sound.json` NOAA ENC Direct Harbour
COALNE snapshot and matching Harbour coverage polygons. Regenerate it with
`node scripts/download-noaa-enc-coastline.mjs`; its adjacent metadata records
source endpoints, retrieval time, SHA-256, bounding box, and non-navigation
warning.

When global leaderboard indexing is disabled, leaderboard URLs are omitted from
the sitemap and leaderboard material is omitted from `llms.txt`; rendered
leaderboard pages receive `noindex,follow`. When the public feature itself is
disabled, public leaderboard APIs return `404` with a `noindex` signal. The
web server still returns a noindex SPA shell for leaderboard paths so an
authenticated allowlisted user can direct-navigate or refresh; that shell does
not expose ranking data, and the private subject allowlist never makes content
public.

## Vessel check-in contract

`POST /api/leaderboards/checkins/vessels` requires authentication, a fresh foreground location (`latitude`, `longitude`, `accuracyMeters`, `observedAt`), `vesselId`, and the current `sailingId`. The server discards submitted coordinate evidence after checking it. It credits only when the device accuracy circle is within 250 m of a fresh, in-service, underway WSF vessel status; its server-derived sailing identity matches; and `shoreDistanceMeters - accuracyMeters >= 152.4` (500 ft). A user can receive at most one credit per stable sailing identity. The check fails closed outside snapshot coverage and on stale, malformed, docked, or otherwise ambiguous vessel data. It is non-navigation-only and GPS self-attestation, not proof of physical presence or a defense against all mocked locations or compromised devices.

Coordinates, accuracy, and device timestamps are used only for server policy checks on an open-app terminal check-in and are not stored or logged. Current foreground verification is GPS self-attestation: it is not cryptographic proof of physical presence and does not detect all mocked-location or device-compromise scenarios. Device-backed attestation and its operational review are required before production enablement where physical-presence assurance is needed. Public ranks expose only rank, label, and score. `DELETE /api/leaderboards/account` transactionally calls `anonymizeLeaderboardAccount(subject, transaction)` to remove leaderboard identity/settings and irreversibly anonymize retained scores. It does **not** delete the Auth0 account; a full Auth0 account-deletion workflow does not exist in this repository.

Leaderboard identity is intentionally separate from a login profile. `PUT /api/leaderboards/preferences` accepts either a moderated `displayName` or an `initials` field (for example `"AL"`), never both. The submitted label is the only name value received and stored for leaderboard display; clients must not infer or submit a full account-profile name without a user's explicit choice. The default public presentation remains initials unless `useFullName` is explicitly enabled. `notificationsEnabled` defaults to on for silent check-in summaries; `verboseNotificationsEnabled` defaults to off and is reserved for optional detailed leaderboard notifications. `optedOut` is always returned by the preferences API and prevents future check-ins while preserving anonymized existing scores after account deletion.

The client turns an accepted check-in response into a silent local notification. The server deliberately does not persist an unconsumed notification outbox.

## Foreground presence contract

`POST /api/leaderboards/presence/terminals` requires authentication and the same transient payload as terminal check-in: `terminalId`, `latitude`, `longitude`, `accuracyMeters`, and `observedAt`. It is available only when the authenticated subject is enabled for leaderboards. A response of `{ "recorded": true }` means the location was definitely outside the terminal geofence and the durable exit state was recorded; the submitted location evidence is discarded. It does not award a score. Clients should send this while the app is open after leaving a terminal so a later check-in can satisfy the required exit plus cooldown rule.
