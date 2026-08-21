# App-store advertising launch checklist

Last reviewed: August 21, 2026.

This checklist covers Ferry FYI's directly served contextual advertisements.
Ferry FYI does not use a third-party advertising network or advertising SDK.
Campaigns may still promote third-party advertisers, so store questions about
whether the app contains advertising must be answered **yes**.

## Repository controls

The app-store builds enforce these advertising boundaries:

- Ads are selected only from the current page and, when relevant, route
  direction. Account data, precise location, saved tickets, notification
  settings, advertising identifiers, prior activity, and off-app activity are
  excluded from selection.
- Every creative identifies the advertiser, is labeled `Advertisement`, links
  to the in-app contextual-selection explanation, and provides a `Report ad`
  email action.
- Measurement uses a random two-hour exposure token. The server stores only a
  one-way token hash, campaign and placement context, fixed claim flags, and a
  Pacific reporting bucket. Advertiser reports contain aggregate totals only.
- The Android manifest removes the Google `AD_ID` permission, and native-build
  CI rejects any dependency that merges it back into the packaged manifest.
- The iOS privacy manifest declares `NSPrivacyTracking` as false, and archive CI
  rejects an App Tracking Transparency usage description.
- Google tags receive denied advertising-storage, advertising-user-data, and
  ad-personalization consent defaults. Google signals and ad personalization
  are also disabled in the Google Analytics configuration.
- Ads remain out of account, sign-in, saved-ticket, barcode, notification, and
  service-alert surfaces.

These controls support the current declarations. Reassess every store answer
before adding an ad SDK, device identifier, behavioral selection, user profile,
new ad surface, event-level advertiser export, or cross-app/cross-site data.

## Google Play Console

Complete these items under **Policy and programs > App content**. Google
requires the declaration even when ads are rendered without an ad SDK. See the
official [Prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455)
and [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
guides.

### Ads

1. Open **Ads**.
2. Select **Yes, my app contains ads**.
3. Save the declaration.

This adds the public `Contains ads` label. Do not answer no merely because
Ferry FYI serves the creative itself.

### Data safety advertising delta

Merge these answers into the app's existing full Data safety form; do not
replace declarations for authentication, location, tickets, notifications,
analytics, crash reporting, or other features.

| Question             | Advertising answer                                                                   |
| -------------------- | ------------------------------------------------------------------------------------ |
| Data type            | **App activity > App interactions**                                                  |
| Collected            | **Yes**                                                                              |
| Shared               | **No** for the current fully anonymous aggregate advertiser reports                  |
| Ephemeral processing | **No**; duplicate-suppression rows last up to two hours and aggregate totals persist |
| Required or optional | **Required** where an enabled ad placement is displayed                              |
| Purpose              | **Advertising or marketing**                                                         |
| Encrypted in transit | **Yes**                                                                              |

The random exposure token is specific to one event envelope and does not
reasonably identify a device, browser, app installation, session, visitor, or
account. Do not add **Device or other IDs** for the first-party ad system. Keep
any existing Device ID declaration required by notification, analytics, or
diagnostic services.

The aggregate-report sharing answer relies on Google's anonymous-data sharing
exception. Change it to **Shared** before giving an advertiser event-level,
token-level, device-level, account-level, or otherwise re-identifiable data.

### Advertising ID

If Play Console asks whether the app uses the Android advertising ID, answer
**No**. The app neither requests nor reads it. Before each release, confirm the
App Bundle's merged manifest still lacks
`com.google.android.gms.permission.AD_ID`. Google's
[Advertising ID guidance](https://support.google.com/googleplay/android-developer/answer/6048248)
explains that SDK manifests can otherwise merge this permission automatically.

### Privacy policy and audience

1. Set the privacy-policy URL to `https://ferry.fyi/privacy`.
2. Revisit **Target audience and content** and the content-rating questionnaire.
3. Keep the target audience consistent with the policy statement that Ferry
   FYI is not directed to children under 13. Do not add an under-13 age band
   without a separate Families-policy review and corresponding product changes.
4. Confirm every campaign and destination is appropriate for the app's assigned
   content rating. Google treats ads and their offers as part of the app; see
   the [content-rating requirements](https://support.google.com/googleplay/android-developer/answer/9859655).

## App Store Connect

Apple requires advertising to be reflected in both the privacy answers and the
age-rating questionnaire. Its review rules also require an in-app way to report
inappropriate ads. See Apple's [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/),
[age-rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions),
and [App Review Guideline 2.5.18](https://developer.apple.com/app-store/review/guidelines/#software-requirements).

### App Privacy

Merge the following advertising answers into the app's existing privacy
details. Do not remove broader declarations required by Auth0, Google Analytics,
Firebase, Sentry, Mapbox, account features, tickets, or location features.

| Data type               | Collected | Linked to identity                             | Tracking | Purpose                                              |
| ----------------------- | --------- | ---------------------------------------------- | -------- | ---------------------------------------------------- |
| **Advertising Data**    | Yes       | No                                             | No       | Third-Party Advertising                              |
| **Product Interaction** | Yes       | Keep the existing conservative app-wide answer | No       | Add Third-Party Advertising to the existing purposes |

Apple uses **Third-Party Advertising** for displaying paid promotions from
outside advertisers, even when Ferry FYI—not an ad network—serves the creative.
Use **Developer's Advertising or Marketing** only for future Ferry FYI house ads
or direct marketing. Product Interaction may already be marked linked because
Google Analytics uses a browser or app-scoped identifier; the anonymous Ferry
FYI ad token does not justify changing that broader answer to unlinked.

Set **Data Used to Track You** to **No**. Do not add
`NSUserTrackingUsageDescription` or request App Tracking Transparency while the
current no-tracking contract remains in force.

Set both of these App Store privacy links:

- Privacy Policy: `https://ferry.fyi/privacy`
- Privacy Choices: `https://ferry.fyi/privacy`

### Age rating

1. Open **General > App Information > Age Ratings**.
2. Edit the questionnaire.
3. Mark the **Advertising** capability as present.
4. Reconfirm the generated global and regional ratings.

Every campaign must remain suitable for the resulting age rating. The owner
campaign policy already excludes adult, gambling, tobacco, drug, weapon,
political, deceptive, predatory-finance, and unsafe-alcohol creative.

### App Review notes

Include this text with the first advertising-enabled submission, adjusted only
for the route where an active review campaign can be seen:

> Ferry FYI displays manually reviewed contextual text advertisements on its
> home and ferry-planning pages. It uses no third-party ad network or ad
> SDK, IDFA, advertising identifier, cross-app tracking, or behavioral profile.
> Selection uses only the current page and route direction. Anonymous
> two-hour exposure tokens provide aggregate campaign counts and are not linked
> to an account, device, browser, visitor, or session. Each advertisement names
> the advertiser, links to the contextual-selection explanation, and includes
> a Report ad action. Ads do not appear in notifications, extensions, account, sign-in,
> ticket, barcode, or service-alert surfaces.

Provide the reviewer with the exact page containing the active campaign and
keep that campaign enabled throughout review. If no ad is visible, explain the
campaign schedule rather than asking review to infer the business model.

## Google Analytics and Tag Manager

The app now sends denied advertising consent before Google tags load and sets
`allow_google_signals` and `allow_ad_personalization_signals` to false. Keep the
Google-owned configuration aligned with that code:

1. In Google Analytics, open **Admin > Data collection and modification > Data
   collection**. Under **Advanced Settings to Allow for Ads Personalization**,
   turn every geographic region off.
2. Open the web data stream, then **Configure tag settings > Manage data
   transmission**. Select **Restrict advertising data transmission > Don't
   transmit any advertising data** while retaining the behavioral analytics
   needed for Ferry FYI's aggregate product analytics.
3. Under **Product links > Google Ads links**, remove any unused link. If a link
   must remain, turn **Enable Personalized Advertising** off.
4. In Google Tag Manager, confirm the published container has no Google Ads,
   Floodlight, remarketing, enhanced-conversion, or advertiser-controlled tag.
   On every Google tag, keep `allow_google_signals` and
   `allow_ad_personalization_signals` set to `false`.
5. Use Tag Assistant preview on an ad-bearing route and confirm the consent
   defaults are `denied` for `ad_storage`, `ad_user_data`, and
   `ad_personalization` before publishing the container.

Google is changing the division of responsibility between Analytics, Ads, and
Consent Mode during 2026. Recheck the official [Analytics data-control
updates](https://support.google.com/analytics/answer/17016975), [tag privacy
settings](https://developers.google.com/tag-platform/security/guides/privacy),
and [consent setup](https://developers.google.com/tag-platform/security/guides/consent)
at each release rather than relying only on the current Analytics UI labels.

## Campaign launch gate

Before enabling the persisted global ad switch:

1. Finish both stores' declarations above and save screenshots or exported
   answers with the release record.
2. Verify the advertiser identity, creative, destination URL, and landing-page
   content against the owner policy and both stores' assigned ratings.
3. Open the creative on web, Android, and iOS; confirm the label, contextual
   explanation link, advertiser destination, and Report ad action.
4. Confirm the destination uses HTTPS and does not imitate Ferry FYI, WSF, or
   WSDOT controls or safety information.
5. Schedule the campaign, verify its aggregate report boundary, then enable the
   placement and global switch.
6. Monitor `dev@ferry.fyi` and pause a campaign immediately when a credible
   policy, safety, age-appropriateness, or destination complaint arrives.
