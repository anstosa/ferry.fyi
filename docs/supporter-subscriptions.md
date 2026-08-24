# Ferry FYI Supporter subscriptions

Last reviewed: August 23, 2026.

Ferry FYI Supporter is one account-linked RevenueCat entitlement sold through
RevenueCat Billing on the website, Apple in-app purchase, and Google Play
Billing. The US base prices are `$2.49/month` and `$19.99/year`. Storefront SDK
prices are the user-facing source of truth because currency, tax, and regional
pricing can vary.

## Product contract

- Entitlement: `ferry_fyi_supporter`
- Current offering: `default`
- Apple products: `fyi.ferry.supporter.monthly` and
  `fyi.ferry.supporter.annual`
- Google subscriptions/base plans: `supporter_monthly:supporter-monthly` and
  `supporter_yearly:supporter-yearly`
- RevenueCat Billing products: `supporter_monthly` and `supporter_annual`
- Launch benefits: no Ferry FYI ads while signed in and an optional public
  Supporter leaderboard badge that defaults off
- Free features: schedules, service information, alerts, cameras, forecasts,
  tickets, and manual check-ins
- Automatic check-ins remain deferred and are not enabled by subscription
  status

Purchases and restores require a signed-in Ferry FYI account. The app sends a
server-generated random UUID to RevenueCat rather than an email address or raw
Auth0 subject. Native apps show only their native store checkout and restore
controls. The website shows only RevenueCat Billing checkout.

## Webhook endpoints

- Production: `https://ferry.fyi/api/supporter/revenuecat/webhook/production`
- Sandbox: `https://ferry.fyi/api/supporter/revenuecat/webhook/sandbox`

Each RevenueCat integration must send its configured Authorization header and
HMAC signature. Ferry FYI validates the exact raw request bytes, the five-minute
timestamp window, and both credentials before parsing JSON. The server stores
only a body hash and privacy-minimal routing metadata, deduplicates by project
and event ID, then reconciles the customer through environment-filtered
RevenueCat API v2 subscription reads. Raw payloads, receipts, payment details,
and management URLs are not retained.

Required server-only configuration:

- `REVENUECAT_PROJECT_ID`
- `REVENUECAT_V2_SECRET_API_KEY`
- `REVENUECAT_PRODUCTION_WEBHOOK_AUTHORIZATION`
- `REVENUECAT_PRODUCTION_WEBHOOK_HMAC_SECRET`
- `REVENUECAT_SANDBOX_WEBHOOK_AUTHORIZATION`
- `REVENUECAT_SANDBOX_WEBHOOK_HMAC_SECRET`
- `SUPPORTER_ACTION_HMAC_SECRET`

Public client build configuration:

- `REVENUECAT_WEB_PUBLIC_API_KEY`
- `REVENUECAT_IOS_PUBLIC_API_KEY`
- `REVENUECAT_ANDROID_PUBLIC_API_KEY`

Production web builds require the RevenueCat Billing production key, which
starts with `rcb_` but not `rcb_sb_`. A sandbox Stripe connection or an account
that is not live-capable prevents production checkout. If a live-capable
account still does not expose a production key, contact RevenueCat support.
Keep `SUPPORTER_WEB_CHECKOUT_ENABLED=false` until the live key exists, is stored
in the GitHub Actions variable, and has been deployed.

Checkout kill switches are server-owned and default closed:

- `SUPPORTER_WEB_CHECKOUT_ENABLED`
- `SUPPORTER_IOS_CHECKOUT_ENABLED`
- `SUPPORTER_ANDROID_CHECKOUT_ENABLED`

Webhook intake and existing entitlement reconciliation remain on when checkout
is off.

## Store and provider checklist

### RevenueCat

1. Keep monthly and annual packages in the current `default` offering for all
   three production apps.
2. Keep production restore behavior at **Keep with original App User ID**.
3. Keep webhook Authorization and HMAC enabled for both endpoints.
4. Keep App Store server notifications and Google real-time developer
   notifications connected.
5. Keep RevenueCat Billing connected to the intended Stripe account and enable
   tax collection appropriate to the business and customer jurisdictions.
6. Do not add subscriber email/name attributes, advertising identifiers,
   attribution integrations, or a RevenueCat advertising integration.

### App Store Connect

1. Put monthly and annual products in one **Ferry FYI Supporter** subscription
   group at the same service level.
2. Verify the displayed US prices are `$2.49` and `$19.99`, with no trial or
   introductory offer.
3. Submit the first subscription products with an app version and include a
   signed-in review account plus steps to open Supporter from Account or Menu.
4. Add Purchase History and the random subscription User ID to App Privacy;
   mark the identifier linked to the account but not used for tracking.
5. Keep the privacy URL `https://ferry.fyi/privacy`, terms URL
   `https://ferry.fyi/terms`, and support URL `https://ferry.fyi/support`.

### Google Play Console

1. Keep the `supporter_monthly` and `supporter_yearly` subscriptions active
   with their matching auto-renewing base plans and no offers.
2. Verify US prices are `$2.49` and `$19.99` and activate every intended region.
3. Add RevenueCat purchase history and the random account-linked user ID to the
   complete Data safety declaration; do not describe either as advertising.
4. Use license testers for internal purchase tests and confirm Play account,
   tester list, and installed build match.

## Required test matrix

Before enabling a checkout channel, prove on that channel: new purchase,
renewal, cancellation with paid-through access, billing issue or grace,
expiration, refund or revocation, restore, account switch, account deletion
warning, webhook duplication, webhook retry, provider outage, and ad-free
server enforcement. A client RevenueCat result never grants server-visible
benefits until `/api/supporter/reconcile` completes.

Deleting a Ferry FYI account does not cancel provider billing. The app requires
an explicit continuing-billing acknowledgement when current or uncertain paid
state exists, permanently detaches the random billing customer from the Auth0
subject, and retains only privacy-minimal lifecycle audit state.
