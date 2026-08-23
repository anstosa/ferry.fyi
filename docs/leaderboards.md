# Leaderboards

Leaderboards use a DB-backed `leaderboards` feature flag. Public pages and
public ranking APIs require the global enabled state and are disabled by a kill
switch. Authenticated leaderboard/check-in requests can additionally admit a
normalized Auth0 subject allowlist while the global flag is off; a kill switch
still wins. The anonymous `/api/features` endpoint reports only global public
decisions, while authenticated clients use `/api/features/me`. There is no
percentage rollout or expiry. Automatic check-ins use a separate
`automaticLeaderboardCheckins` child flag with the same kill/global/subject
precedence. The child never bypasses the parent. Production Android and iOS
builds keep the native capability off; the subject flag only exposes enrollment
in an explicitly capable native build. The server uses the
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

Coordinates, accuracy, and device timestamps are used only for server policy checks on an open-app terminal check-in and are not stored or logged. Current foreground verification is GPS self-attestation: it is not cryptographic proof of physical presence and does not detect all mocked-location or device-compromise scenarios. Device-backed attestation and its operational review are required before production enablement where physical-presence assurance is needed. Public ranks expose only rank, label, and score. `DELETE /api/leaderboards/account` transactionally calls `anonymizeLeaderboardAccount(subject, transaction)` to remove leaderboard identity/settings and irreversibly anonymize retained scores without deleting the main account. Full account deletion through `DELETE /api/user` uses the same anonymization boundary before deleting the Auth0 identity.

Leaderboard identity is intentionally separate from a login profile. `PUT /api/leaderboards/preferences` accepts either a moderated `displayName` or an `initials` field (for example `"AL"`), never both. The submitted value is the public leaderboard label: an automatically proposed default contains initials only, while a name or alias appears only after the user explicitly enters it. Clients must not infer or submit a full account-profile name without that explicit choice. The legacy `useFullName` preference remains in the wire contract but no longer changes the chosen label. `notificationsEnabled` defaults to on for silent check-in summaries; `verboseNotificationsEnabled` defaults to off and is reserved for optional detailed leaderboard notifications. `optedOut` is always returned by the preferences API and prevents future check-ins while preserving anonymized existing scores after account deletion.

An active Ferry FYI Supporter can separately enable `supporterBadgeVisible`.
The preference defaults off and the public leaderboard emits a Supporter badge
only while the server-authoritative production entitlement remains active.
Supporter status does not change scoring or enable automatic check-ins.

The client turns an accepted check-in response into a silent local notification. The server deliberately does not persist an unconsumed notification outbox.

## Automatic native enrollment

Automatic enrollment is native-only and explicit. The client completes these
steps in order: prominent disclosure, precise foreground permission, platform
background/Always guidance, device bootstrap nonce, authenticated server
enrollment, native credential installation, native configuration and region
health, authenticated health acknowledgement, and finally the profile
`automaticCheckinsEnabled` preference. The preference is never written true
before all prior barriers succeed. Any failure leaves it off, purges native
material, revokes the partial enrollment, and preserves manual check-in. An
unconfirmed rollback persists a separate detail-free device-keyed cleanup proof,
so an exact-subject retry survives process restart without letting another
signed-in account trigger account-wide revocation.

The native credential is scoped to config/status/candidate/revoke endpoints,
bound to one device-only installation nonce, encrypted outside JavaScript, and
excluded from backup/transfer. JavaScript handles the one-time server response
only long enough to call `installCredential`. Native code then binds it to a
keyed device-only owner proof without storing, returning, or logging the raw
Auth0 subject; native status exposes ten fixed
aggregate fields and never candidate, terminal, vessel, coordinate, or timing
detail. The native credited event is an empty `leaderboard-checkins-changed`
signal. A visible screen responds by refetching its own authenticated status.

Automatic candidates are best-effort GPS self-attestation, not cryptographic
proof of physical presence or boarding. A candidate is encrypted on the device,
becomes ineligible exactly 12 hours after capture, and is submitted only to the
compiled Ferry FYI origin. Its encrypted file is physically removed at the next
eligible operating-system execution and is never uploaded after expiry. The
server verifies terminal evidence against immutable terminal configuration,
discards submitted coordinates after verification, and retains only the credited
result and coarse eligibility state. Server-derived WSF history is reserved for
disabled, unapproved automatic vessel proof. Automatic vessel detection and
credit remain off; existing manual vessel check-in remains available under its
separately documented live-vessel and shoreline rules.

The capability requires Android 10/API 29 or newer or iOS 15 or newer.
Unsupported devices and default-off app builds do not request background
location or enter native enrollment.

Opt-out, logout, account deletion, identity loss, permission downgrade, policy
disablement, and credential expiry are exhaustive native stop boundaries. For
controllable client actions, native generation invalidation and purge run before
server revocation or Auth0 teardown. Account deletion removes the enrollment and
leaderboard identity; retained scores are reassigned only to an irreversible
anonymous identifier.

See [`docs/automatic-leaderboard-checkins.md`](automatic-leaderboard-checkins.md)
for setup, recovery, privacy, and platform limitations.

## Foreground presence contract

`POST /api/leaderboards/presence/terminals` requires authentication and the same transient payload as terminal check-in: `terminalId`, `latitude`, `longitude`, `accuracyMeters`, and `observedAt`. It is available only when the authenticated subject is enabled for leaderboards. A response of `{ "recorded": true }` means the location was definitely outside the terminal geofence and the durable exit state was recorded; the submitted location evidence is discarded. It does not award a score. Clients should send this while the app is open after leaving a terminal so a later check-in can satisfy the required exit plus cooldown rule.
