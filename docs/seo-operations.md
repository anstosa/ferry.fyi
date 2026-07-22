# SEO operations

## After an SEO release

1. Verify `https://ferry.fyi/robots.txt` and `https://ferry.fyi/sitemap.xml` return
   `200` and include only canonical, indexable URLs.
2. In Google Search Console and Bing Webmaster Tools, submit the sitemap and inspect
   the home page, one terminal page, and one route page.
3. Request recrawls for URLs that changed from `200` to `404` or a permanent
   redirect. Do not block those URLs in `robots.txt`; crawlers must be able to
   observe their status or `noindex` directive.
4. Track indexed-page count, query impressions/click-through rate, canonical
   selection, and Core Web Vitals before and after the release.

## Sitemap freshness

`SEO_CONTENT_LAST_MODIFIED` in `shared/lib/seo.ts` is the significant-content
revision date for the indexable server-rendered pages. Update it only when their
visible content, structured data, or canonical links materially change. Do not
advance it for deployment-only changes.
