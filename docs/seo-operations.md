# SEO operations

## Canonical indexability contract

The generated sitemap, document metadata, route manifest, and rendered React
views must agree on the same public URL policy:

- Fixed indexable pages are exactly `SEO_INDEXABLE_PATHS`.
- A terminal page is canonical at `/:terminalSlug/terminal` only when that
  terminal has at least one route.
- A schedule canonical identifies a direction. A one-mate terminal uses
  `/:terminalSlug`; a multi-mate terminal uses
  `/:terminalSlug/:mateSlug`.
- The indexable route tabs are exactly `SEO_INDEXABLE_ROUTE_VIEWS`: cameras,
  map, alerts, subscribe, and fare. Each description names the direction and
  explains that tab's purpose. `terminal` is terminal-owned, not a mate tab.
- A schedule with a non-default `date` query is `noindex,follow` and points to
  the undated direction canonical.
- `/today` is `noindex,follow` on `ferry.fyi`. The root page on
  `howmanyboats.today` has its own indexable host profile and canonical.
- Leaderboard index, terminal, and vessel URLs enter the sitemap only when the
  global public feature and persisted leaderboard-indexing control are both
  enabled. Otherwise documents are `noindex,follow`; private, callback, admin,
  settings, unmatched, failure, offline, and 404 documents remain noindex.

`getSitemapUrls` generates metadata before paths and runs the description audit
over that exact set. Do not add a URL directly to sitemap output or create a
second route/indexability list.

## Description release gate

`auditIndexableSeoDescriptions` normalizes whitespace and case, then checks the
complete generated canonical set. Descriptions must be nonempty and unique
after normalization.

- Fewer than 100 characters is always a release failure.
- 120–160 characters is the editorial target.
- A 100–119 character description requires a nonempty, checked-in per-URL
  reason in `SEO_DESCRIPTION_SHORT_RATIONALES`.
- More than 180 characters requires a nonempty, checked-in per-URL review note
  in `SEO_DESCRIPTION_LONG_REVIEW_NOTES`.
- Descriptions from 161–180 characters are allowed but are outside the target;
  shorten them when accuracy is not lost.

Before an SEO release, run the focused sitemap/metadata tests. They generate
every canonical route from the checked-in WSF terminal and route corpus,
include fixed pages and public leaderboard shapes, verify canonical uniqueness,
and separately audit the `howmanyboats.today` profile. Review the actual copy
for product accuracy; a passing character count does not validate a claim.

Every app document must include one nonempty `meta[name="description"]` in
the document `head`, including private, callback, failure, disabled, offline,
and standalone report shells. Non-public shells retain their existing noindex
policy and use request-neutral descriptions; adding metadata must not expose
account details or callback parameters. Seeded descriptions are replaced by
route metadata during hydration rather than retained as duplicate tags.

Every first-party rendered `img` must have an explicit `alt` attribute.
Use meaningful text for informative images and an empty value for decorative
images; do not invent keyword-heavy descriptions. Source-contract tests and
raw/hydrated browser checks enforce attribute presence and metadata placement.

## After an SEO release

1. Verify `https://ferry.fyi/robots.txt` and `https://ferry.fyi/sitemap.xml` return
   `200` and include only canonical, indexable URLs, including the accepted
   public route tabs and any currently indexable leaderboard URLs.
2. In Google Search Console and Bing Webmaster Tools, submit the sitemap and inspect
   the home page, both directions of one route, one terminal page, every route
   tab purpose, one informational page, and the `howmanyboats.today` root.
3. Request recrawls for URLs that changed from `200` to `404` or a permanent
   redirect. Do not block those URLs in `robots.txt`; crawlers must be able to
   observe their status or `noindex` directive.
4. Track indexed-page count, query impressions/click-through rate, canonical
   selection, and Core Web Vitals before and after the release.
5. Confirm persisted crawler and leaderboard controls still drive
   `robots.txt`, sitemap membership, rendered robots metadata, and the
   leaderboard section of `llms.txt` consistently.

## Indexing exclusions and not-found pages

Audit the URL examples exported from each Search Console indexing category
before changing their behavior. `Discovered - currently not indexed` and
`Crawled - currently not indexed` do not identify removed pages. Preserve
useful public pages as `200` responses with truthful content, internal links,
and their reviewed canonical; retain redirects or noindex only where the
existing URL policy calls for them. Return `404` only for missing pages without
an appropriate replacement. The shared not-found view provides schedule and
support recovery links while the server retains the real `404` status and
noindex policy. Do not redirect every unknown URL to the homepage.

Missing canonical tags on `503` failure documents are an availability problem,
not a reason to publish an indexable canonical for an error response. Verify
both the HTTP status and the raw and hydrated head of a successful terminal
page after deployment. A locally repaired page does not establish that the
production release or Google's indexed snapshot has been updated.
Canonical, title, description, and robots checks must target the document
`head`, not merely search the entire HTML. React 19 metadata hoisted while
rendering an app fragment must be moved into the template head before sending
the assembled server document.

See Google's [Page indexing report guidance](https://support.google.com/webmasters/answer/7440203)
and [HTTP status guidance](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes).

## Sitemap freshness

`SEO_CONTENT_LAST_MODIFIED` in `shared/lib/seo.ts` is the significant-content
revision date for the indexable server-rendered pages. Update it only when their
visible content, structured data, or canonical links materially change. Do not
advance it for deployment-only changes. The same revision is emitted as sitemap
`lastmod`, structured-data `dateModified`, and the legacy SEO fallback review
date; it is release metadata, not the freshness timestamp for live ferry data.

## Machine discovery contracts

- `/llms.txt` is the plain-language AI-agent guide and links only to Ferry FYI
  pages and machine documents.
- `/openapi.json` is generated from
  `shared/contracts/publicApiOperations.ts`. Run `yarn generate:openapi` after
  an intentional operation-matrix change and `yarn test:openapi` before review.
- `/data-sources` is an intentionally smaller public-read subset. It is not an
  exhaustive API reference.
- `robots.txt`, `sitemap.xml`, `llms.txt`, `openapi.json`, and
  `/.well-known/security.txt` use bounded five-minute shared freshness plus
  validators. Live HTML and live API data remain no-store.
- The current shared `SEO_CONTENT_LAST_MODIFIED` is intentional. Do not invent
  per-template precision without independently maintained revision histories.

After deployment, retain hashes and headers from
`scripts/smoke-public-contracts.mjs`. Search Console and Bing actions require
verified operator credentials and are external-only; stop if served canonicals,
robots directives, sitemap membership, or feature gates disagree.

## 2026-07-29 editorial review record

The G009 review generated every fixed, terminal, directional schedule, route-tab,
and enabled leaderboard canonical from the checked-in WSF route corpus. All
descriptions passed normalized uniqueness and the 120–160 character target; no
short rationale or long editorial-review exception is active.

The review also confirmed:

- tickets describes saved-ticket/status/scanner value without implying public
  ticket data;
- privacy describes the actual account, foreground-location, ticket,
  notification, analytics, and diagnostic categories;
- feedback describes support, corrections, troubleshooting, and feature
  requests;
- terminal descriptions identify one named terminal;
- every route description identifies its departure-to-arrival direction and
  the schedule, camera, map, bulletin, notification, or fare purpose;
- `/today`, private routes, dated schedules, 404/failure/offline documents, and
  both leaderboard visibility gates retain their accepted noindex behavior;
- served `robots.txt`, sitemap membership, served `llms.txt`, the SSR manifest,
  and visible/structured revision metadata use the same public policy.

## Complete public HTML and origin refresh windows

Static public pages render their full shared informational content, including
mixed-page installation, ticket-wallet and Supporter guidance; device/account
controls mount only after compatible hydration. Dynamic public documents render
the complete anonymous snapshot for the exact canonical URL/default state. The
fare estimator is followed by native `details`/`summary` and a semantic full fare
table, present in initial HTML even while collapsed. Quote selections and totals
remain browser-only.

Dynamic origin reuse follows fixed `03:00` and `15:00` boundaries in
`America/Los_Angeles`, not a rolling twelve-hour TTL. Overnight DST windows can
span eleven or thirteen elapsed hours. Filling is lazy and process-local, with
bounded entries; restarts and capacity eviction can refill within a window.
Static pages retain release/process-lifetime reuse. Browser/CDN document headers
remain `no-store`; source timestamps and stale/unavailable states are separate
from document-generation timestamps. Live APIs and browser refresh retain their
existing freshness policies.

Ad-bearing pages are cacheable. Each request observes the effective DB-backed
placement creative (or empty slot) using the current clock; a public semantic
fingerprint prevents old variants from being served after global/placement
controls, campaign replacement or start/end/early-end changes. In-flight fills
are revalidated before commit/return, and coalesced callers revalidate after
waiting. This is request-gated coherence across instances, not a push invalidation
bus. Cached creatives never contain per-visitor exposure tokens; native no-JS
views/clicks are unmeasured, while browser ads resolve current policy and issue
fresh measurement envelopes after hydration.
