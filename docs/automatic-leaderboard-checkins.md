# Automatic leaderboard check-ins

Automatic leaderboard check-ins are an explicit, native-only, best-effort
convenience. They do not exist in the web/PWA build, do not replace manual
check-in, and are not proof of boarding or physical presence. Production native
capability flags remain off until the separate G010 physical-device and store
evidence gates pass. The capability requires Android 10/API 29 or newer or iOS
15 or newer; unsupported devices remain inert before disclosure, permissions,
credentials, or work.

## Enrollment order

The authenticated settings screen performs one all-or-off transaction:

1. Show the background-location, encrypted-retention, verification, and manual-fallback disclosure.
2. Ask for precise foreground location after the user accepts the disclosure.
3. Guide Android to app settings for background access, or request iOS Always authorization.
4. Ask native code for a one-time device installation nonce.
5. Create a pending subject-owned enrollment through Auth0 and receive one scoped credential.
6. Install that credential into device-only native storage. JavaScript does not persist or echo it.
7. Bind the installed credential to a device-only keyed owner proof. Native code never persists, returns, or logs the raw Auth0 subject.
8. Reconcile trusted server time, immutable terminal config, permission health, and the complete owned region set.
9. Confirm exact aggregate healthy detector state to the authenticated server route.
10. Set `automaticCheckinsEnabled=true` last.

If any step fails, the client confirms preference-off, partial-enrollment
revocation, and native purge before reporting a safe rollback. Any unconfirmed
step remains `cleanup_required`, blocks a new enrollment attempt, and exposes a
retry action while manual check-in remains available. Before local purge, native
code stores a separate device-keyed cleanup proof for the current account. It
contains no raw subject or credential, survives identity purge and process
restart, and is cleared only after exact-subject local purge plus the ungated
account-wide disable acknowledgement. A different signed-in account cannot use
that proof to revoke the original account.

## Data and retention

- Native credentials are installation-bound, device-only, scoped, encrypted, and excluded from backup or transfer.
- Native ownership checks persist only a keyed device proof; the raw Auth0 subject is transient bridge input and is never returned or stored.
- Incomplete rollback persists only a keyed cleanup-owner proof; it exposes no subject, enrollment identifier, bearer, candidate, or location detail.
- Candidate fields never enter JavaScript, analytics, logs, notifications, or crash reports.
- Each candidate has one reviewed AEAD ciphertext record and becomes ineligible exactly 12 hours after trusted-time capture. Its encrypted file can remain until the next eligible operating-system execution performs deletion-only cleanup; it is never uploaded after expiry.
- Uploads are zero-input native work, oldest-first, one record at a time, and exact final outcomes delete ciphertext before any aggregate effect.
- Ferry FYI validates terminal evidence against immutable terminal configuration, then discards submitted coordinates. Server-derived WSF history is reserved for disabled, unapproved automatic vessel proof.
- Retained server state contains only a result, coarse eligibility/receipt state, and the user’s chosen leaderboard label.

## Status and recovery

The bridge returns only capability/config generations, credential-expiry bucket,
last aggregate outcome, monitor health, pending count, permission health,
platform, and schema version. A credited event has no payload; visible screens
refetch their own authenticated entity status.

Recovery is truthful and manual-first:

- **Permission denied or approximate:** enable precise background/Always location, then retry.
- **iOS Background App Refresh off:** enable it in Settings, then retry.
- **First unlock required:** unlock once after restart. Later relocking remains supported.
- **Android force-stop or iOS force-quit:** reopen Ferry FYI. The OS may suppress passive work until then.
- **Stale config, registration failure, unavailable geofencing, offline, or expired credential:** automatic credit stops or retries only within the reviewed bound; manual check-in remains available.

The app must never say detection is complete, guaranteed, or always running.

## Stop and deletion order

Opt-out, logout, account deletion, credential expiry, revocation, permission
downgrade, and policy disablement advance the local work generation and converge
region removal, work cancellation, callback/candidate cleanup, credential/key
deletion, and binding deletion. For user-controlled actions, local stop and purge
run before server revocation or Auth0 teardown. Failed cleanup blocks capture and
retries deletion-only; it does not expose a stale success.

Account deletion removes the Auth0 profile, Ferry FYI settings, enrollment, and
device material. Existing scores may remain only after reassignment to an
irreversible anonymous identifier.

## Rollout and store statements

The server `automaticLeaderboardCheckins` flag has an independent global state,
subject allowlist, and emergency kill switch, and is always parent-gated by
`leaderboards`. Default Android Debug/Release and iOS production builds remain
inert. Store privacy answers must disclose optional precise background location,
device-only encrypted temporary storage, authenticated server transmission,
verification-only coordinate use, the exact 12-hour logical eligibility window,
and physical deletion at the next eligible operating-system execution. They
must not claim continuous tracking, guaranteed check-ins, proof of boarding, or
background support on web.
