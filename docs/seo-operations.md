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
