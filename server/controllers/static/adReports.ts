import express, { type Router } from "express";
import { rateLimit } from "express-rate-limit";
import { isObject } from "shared/lib/objects";

import {
  campaignReportCsv,
  getSharedAdCampaignReport,
} from "~/lib/admin/adCampaigns";

const LEGACY_REPORT_HOST = "reports.santosa.family";

// apply private report protections
const applyReportHeaders = (response: express.Response): void => {
  response.set({
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "Surrogate-Control": "no-store",
    "X-Robots-Tag": "noindex, noarchive, nofollow",
  });
};

const legacyRedirectHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Moving Ferry FYI campaign report</title>
  </head>
  <body>
    <p>Opening this campaign report on Ferry FYI…</p>
    <script defer src="/legacy-ad-report-redirect.js"></script>
  </body>
</html>`;

const legacyRedirectScript = `(() => {
  const target = new URL("/ad-reports/", "https://ferry.fyi");
  target.hash = location.hash;
  location.replace(target);
})();`;

const reportHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="theme-color" content="#016f52">
    <title>Ferry FYI campaign report</title>
    <link rel="icon" href="/static/images/favicon.ico" sizes="any">
    <link rel="stylesheet" href="/ad-reports/report.css">
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/" aria-label="Ferry FYI home">
        <img src="/static/images/ferry-fyi-logo.png" alt="" width="48" height="48">
        <span>Ferry FYI</span>
      </a>
    </header>
    <main>
      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Advertiser reporting</p>
        <h1 id="page-title">Campaign report</h1>
        <p>Private, aggregate performance reporting for a Ferry FYI campaign.</p>
      </section>
      <section class="report-card" aria-live="polite">
        <p class="status" id="status">Loading aggregate campaign report…</p>
        <div id="report" hidden>
          <div class="report-heading">
            <div>
              <p class="eyebrow">Campaign</p>
              <h2 id="name"></h2>
              <p class="campaign-meta" id="campaign-meta"></p>
            </div>
            <button class="primary-button" id="download" type="button">Download CSV</button>
          </div>
          <dl class="totals" id="totals"></dl>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Opportunities</th>
                  <th scope="col">Served</th>
                  <th scope="col">Viewable</th>
                  <th scope="col">Clicks</th>
                </tr>
              </thead>
              <tbody id="daily"></tbody>
            </table>
          </div>
          <p class="methodology" id="methodology"></p>
        </div>
      </section>
    </main>
    <footer>
      <span>Ferry FYI</span>
      <span aria-hidden="true">·</span>
      <a href="/privacy">Privacy</a>
      <span aria-hidden="true">·</span>
      <a href="/terms">Terms</a>
    </footer>
    <script defer src="/ad-reports/report.js"></script>
  </body>
</html>`;

const reportCss = `
:root { color-scheme: light dark; font-family: "Ferry Sans Flex", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { min-height: 100vh; margin: 0; background: #f7faf9; color: #1f1f1f; }
.site-header { background: linear-gradient(135deg, #016f52 0%, #004d61 100%); padding: 1rem max(1.25rem, env(safe-area-inset-left)); }
.brand { display: inline-flex; align-items: center; gap: .75rem; color: #fff; font-size: 1.25rem; font-weight: 800; text-decoration: none; }
.brand img { width: 2.75rem; height: 2.75rem; border-radius: .85rem; box-shadow: 0 .35rem 1rem rgb(0 0 0 / 20%); }
main { width: min(100% - 2rem, 62rem); margin: 0 auto; padding: 2.5rem 0 4rem; }
.hero { max-width: 44rem; margin-bottom: 1.5rem; }
.eyebrow { margin: 0 0 .35rem; color: #016f52; font-size: .75rem; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: .5rem; font-size: clamp(2rem, 7vw, 3.25rem); line-height: 1; }
h2 { margin-bottom: .35rem; font-size: clamp(1.45rem, 4vw, 2rem); }
.hero > p:last-child, .campaign-meta, .methodology { color: #3d3d3d; }
.report-card { border: 1px solid #d7e4df; border-radius: 1.25rem; background: #fff; box-shadow: 0 1rem 2.5rem rgb(0 47 59 / 10%); padding: clamp(1.1rem, 4vw, 2rem); }
.status { margin: 0; color: #3d3d3d; }
.status.error { border: 1px solid #efc1bd; border-radius: .8rem; background: #fde7e7; color: #8b1e16; padding: 1rem; }
.report-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1.25rem; }
.campaign-meta { margin-bottom: 0; font-size: .9rem; }
.primary-button { flex: 0 0 auto; border: 0; border-radius: 999px; background: #016f52; color: #fff; cursor: pointer; font: inherit; font-weight: 800; padding: .75rem 1.1rem; }
.primary-button:hover { background: #005c45; }
.primary-button:focus-visible, a:focus-visible { outline: 3px solid #f2b705; outline-offset: 3px; }
.totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin: 1.75rem 0; }
.metric { min-width: 0; border: 1px solid #d7e4df; border-radius: .9rem; background: #f5faf8; padding: .9rem; }
.metric dt { color: #3d3d3d; font-size: .75rem; font-weight: 750; line-height: 1.25; }
.metric dd { margin: .3rem 0 0; color: #004d61; font-size: 1.5rem; font-weight: 850; overflow-wrap: anywhere; }
.table-wrap { overflow-x: auto; border: 1px solid #e5e5e5; border-radius: .9rem; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: .8rem .9rem; text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
th { background: #e6f4f0; color: #004d61; font-size: .75rem; letter-spacing: .03em; text-transform: uppercase; }
tbody tr + tr { border-top: 1px solid #e5e5e5; }
.methodology { margin: 1.25rem 0 0; font-size: .8rem; line-height: 1.55; }
footer { display: flex; justify-content: center; gap: .5rem; border-top: 1px solid #d7e4df; color: #3d3d3d; font-size: .8rem; padding: 1.5rem; }
footer a { color: #016f52; font-weight: 700; }
[hidden] { display: none !important; }
@media (max-width: 44rem) {
  .report-heading { align-items: stretch; flex-direction: column; }
  .primary-button { width: 100%; }
  .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-color-scheme: dark) {
  body { background: #002f3b; color: #f7faf9; }
  .eyebrow, footer a { color: #6fb8a6; }
  .hero > p:last-child, .campaign-meta, .methodology, .status, footer { color: #d7e4df; }
  .report-card { border-color: #336b79; background: #004052; box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 25%); }
  .metric { border-color: #336b79; background: #003746; }
  .metric dt { color: #d7e4df; }
  .metric dd { color: #8fd2c1; }
  .table-wrap, tbody tr + tr, footer { border-color: #336b79; }
  th { background: #004d61; color: #dff7f0; }
  .status.error { border-color: #8b1e16; background: #4f1714; color: #ffd7d3; }
}
`;

const reportScript = `(() => {
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const status = document.getElementById("status");
  const reportRoot = document.getElementById("report");

  // exchange one fragment token
  const post = (path) => fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });

  // append one aggregate metric
  const addTotal = (label, value) => {
    const wrapper = document.createElement("div");
    wrapper.className = "metric";
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value ?? "—";
    wrapper.append(term, detail);
    document.getElementById("totals").append(wrapper);
  };

  // render one aggregate report
  const renderReport = (report) => {
    document.getElementById("name").textContent = report.campaign.reportName;
    document.getElementById("campaign-meta").textContent = report.campaign.advertiserName;
    document.getElementById("methodology").textContent = report.methodology;
    addTotal("Opportunities", report.totals.opportunityCount);
    addTotal("Served ads", report.totals.servedCount);
    addTotal("Viewable impressions", report.totals.viewableCount);
    addTotal("Viewability rate", report.totals.viewabilityRate);
    addTotal("Clicks", report.totals.clickCount);
    addTotal("Clicks per viewable impression", report.totals.clickThroughRate);
    const body = document.getElementById("daily");
    // render daily rows
    for (const row of report.daily) {
      const tableRow = document.createElement("tr");
      // render row values
      for (const value of [row.businessDate, row.opportunityCount, row.servedCount, row.viewableCount, row.clickCount]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        tableRow.append(cell);
      }
      body.append(tableRow);
    }
    status.hidden = true;
    reportRoot.hidden = false;
  };

  // load the private report
  const loadReport = async () => {
    try {
      const response = await post("/ad-reports/report-data");
      // reject invalid shares
      if (!response.ok) {
        throw new Error("invalid report");
      }
      renderReport(await response.json());
    } catch {
      status.className = "status error";
      status.textContent = "This report link is invalid or has been revoked.";
    }
  };

  // download one private export
  const downloadReport = async () => {
    const response = await post("/ad-reports/report-export");
    // reject invalid shares
    if (!response.ok) {
      throw new Error("invalid report");
    }
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = href;
    link.download = "ferry-fyi-campaign-report.csv";
    link.click();
    URL.revokeObjectURL(href);
  };

  // handle one export click
  const handleDownload = () => {
    downloadReport().catch(() => undefined);
  };

  document.getElementById("download").addEventListener("click", handleDownload);
  loadReport().catch(() => undefined);
})();`;

// preserve previously issued report links
export const createLegacyAdReportRedirectRouter = (): Router => {
  const router = express.Router();
  router.use((request, _response, next) => {
    // ignore every non-legacy host
    if (request.hostname.toLowerCase() !== LEGACY_REPORT_HOST) {
      next("router");
      return;
    }
    next();
  });
  router.get("/", (_request, response) => {
    applyReportHeaders(response);
    response.type("text/html").send(legacyRedirectHtml);
  });
  router.get("/legacy-ad-report-redirect.js", (_request, response) => {
    applyReportHeaders(response);
    response.type("application/javascript").send(legacyRedirectScript);
  });
  return router;
};

// create the same-origin private report surface
export const createAdReportRouter = (): Router => {
  const router = express.Router();
  const limiter = rateLimit({
    identifier: "ad-report-access",
    legacyHeaders: false,
    limit: 30,
    standardHeaders: "draft-8",
    windowMs: 60_000,
  });
  const json = express.json({ limit: "4kb" });
  router.get("/", (_request, response) => {
    applyReportHeaders(response);
    response.type("text/html").send(reportHtml);
  });
  router.get("/report.css", (_request, response) => {
    applyReportHeaders(response);
    response.type("text/css").send(reportCss);
  });
  router.get("/report.js", (_request, response) => {
    applyReportHeaders(response);
    response.type("application/javascript").send(reportScript);
  });
  router.post("/report-data", json, limiter, async (request, response) => {
    applyReportHeaders(response);
    // require one bounded body
    if (!isObject(request.body)) {
      response.status(404).send({ error: "resource_not_found" });
      return;
    }
    const report = await getSharedAdCampaignReport(request.body.token);
    // hide invalid report details
    if (!report) {
      response.status(404).send({ error: "resource_not_found" });
      return;
    }
    response.send(report);
  });
  router.post("/report-export", json, limiter, async (request, response) => {
    applyReportHeaders(response);
    const report = isObject(request.body)
      ? await getSharedAdCampaignReport(request.body.token)
      : null;
    // hide invalid report details
    if (!report) {
      response.status(404).type("text/plain").send("Not found");
      return;
    }
    response
      .type("text/csv")
      .attachment("ferry-fyi-campaign-report.csv")
      .send(campaignReportCsv(report));
  });
  return router;
};
