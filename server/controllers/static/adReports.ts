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
          <div>
            <p class="eyebrow">Campaign</p>
            <h2 id="name"></h2>
            <p class="campaign-meta" id="campaign-meta"></p>
            <dl class="campaign-window">
              <div>
                <dt>Start</dt>
                <dd id="campaign-start"></dd>
              </div>
              <div>
                <dt>Stop</dt>
                <dd id="campaign-stop"></dd>
              </div>
            </dl>
          </div>
          <dl class="totals" id="totals"></dl>
          <details class="daily-details">
            <summary>Daily performance by date</summary>
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
          </details>
          <div class="report-actions">
            <button class="download-button" id="download" type="button">Download CSV</button>
          </div>
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
.hero > p:last-child, .campaign-meta { color: #3d3d3d; }
.report-card { border: 1px solid #d7e4df; border-radius: 1.25rem; background: #fff; box-shadow: 0 1rem 2.5rem rgb(0 47 59 / 10%); padding: clamp(1.1rem, 4vw, 2rem); }
.status { margin: 0; color: #3d3d3d; }
.status.error { border: 1px solid #efc1bd; border-radius: .8rem; background: #fde7e7; color: #8b1e16; padding: 1rem; }
.campaign-meta { margin-bottom: 0; font-size: .9rem; }
.campaign-window { display: flex; flex-wrap: wrap; gap: .65rem 1.25rem; margin: .85rem 0 0; font-size: .8rem; }
.campaign-window div { display: flex; flex-wrap: wrap; gap: .35rem; }
.campaign-window dt { color: #3d3d3d; font-weight: 800; }
.campaign-window dd { margin: 0; font-variant-numeric: tabular-nums; }
.download-button { border: 2px solid #016f52; border-radius: 999px; background: transparent; color: #016f52; cursor: pointer; font: inherit; font-weight: 800; padding: .65rem 1.1rem; }
.download-button:hover { background: #e6f4f0; }
.download-button:focus-visible, .metric-help summary:focus-visible, .daily-details > summary:focus-visible, a:focus-visible { outline: 3px solid #f2b705; outline-offset: 3px; }
.totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin: 1.75rem 0; }
.metric { position: relative; min-width: 0; border: 1px solid #d7e4df; border-radius: .9rem; background: #f5faf8; padding: .9rem; }
.metric dt { display: flex; align-items: center; gap: .35rem; color: #3d3d3d; font-size: .75rem; font-weight: 750; line-height: 1.25; }
.metric dd { margin: .3rem 0 0; color: #004d61; font-size: 1.5rem; font-weight: 850; overflow-wrap: anywhere; }
.metric-help { position: static; }
.metric-help summary { display: flex; width: 1rem; height: 1rem; align-items: center; justify-content: center; border-radius: 999px; color: #016f52; cursor: help; list-style: none; }
.metric-help summary::-webkit-details-marker { display: none; }
.metric-help summary::marker { content: ""; }
.info-icon { width: 1rem; height: 1rem; }
.metric-tooltip { position: absolute; top: 2.35rem; right: .6rem; left: .6rem; z-index: 5; border-radius: .65rem; background: #003746; box-shadow: 0 .5rem 1.25rem rgb(0 0 0 / 22%); color: #fff; font-size: .75rem; font-weight: 600; line-height: 1.45; padding: .7rem; }
.metric-benchmark { margin: .35rem 0 0; color: #3d3d3d; font-size: .7rem; font-weight: 700; line-height: 1.3; }
.daily-details { margin-top: .25rem; }
.daily-details > summary { color: #004d61; cursor: pointer; font-size: .9rem; font-weight: 800; }
.daily-details[open] > summary { margin-bottom: .75rem; }
.report-actions { display: flex; justify-content: flex-end; margin-top: 1.5rem; }
.table-wrap { overflow-x: auto; border: 1px solid #e5e5e5; border-radius: .9rem; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: .8rem .9rem; text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
th { background: #e6f4f0; color: #004d61; font-size: .75rem; letter-spacing: .03em; text-transform: uppercase; }
tbody tr + tr { border-top: 1px solid #e5e5e5; }
footer { display: flex; justify-content: center; gap: .5rem; border-top: 1px solid #d7e4df; color: #3d3d3d; font-size: .8rem; padding: 1.5rem; }
footer a { color: #016f52; font-weight: 700; }
[hidden] { display: none !important; }
@media (max-width: 44rem) {
  .download-button { width: 100%; }
  .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-color-scheme: dark) {
  body { background: #002f3b; color: #f7faf9; }
  .eyebrow, footer a { color: #6fb8a6; }
  .hero > p:last-child, .campaign-meta, .campaign-window dt, .metric-benchmark, .status, footer { color: #d7e4df; }
  .report-card { border-color: #336b79; background: #004052; box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 25%); }
  .metric { border-color: #336b79; background: #003746; }
  .metric dt { color: #d7e4df; }
  .metric dd { color: #8fd2c1; }
  .metric-help summary { color: #8fd2c1; }
  .info-icon { filter: invert(1); }
  .daily-details > summary { color: #8fd2c1; }
  .download-button { border-color: #8fd2c1; color: #8fd2c1; }
  .download-button:hover { background: #003746; }
  .table-wrap, tbody tr + tr, footer { border-color: #336b79; }
  th { background: #004d61; color: #dff7f0; }
  .status.error { border-color: #8b1e16; background: #4f1714; color: #ffd7d3; }
}
`;

const reportScript = `(() => {
  // provide benchmark context
  const DISPLAY_CTR_BASELINE = "0.46%";
  // define per-stat explanations
  const METRIC_HELP = {
    clicks: "Aggregate clicks on the campaign creative. This is not a unique-person count or an audited fraud-free total.",
    clickThroughRate: "Clicks divided by served ads, matching the standard display CTR formula. The comparison is the broad 2025 U.S. display-ad average reported by Focus Digital.",
    opportunities: "Times the full ad-slot marker was visible for one continuous second, including scheduled pauses when ad serving was switched off. This is not a billable unit.",
    served: "Campaign ads delivered into an eligible slot. A served ad may not remain visible long enough to become a viewable impression.",
    viewabilityRate: "Viewable impressions divided by served ads.",
    viewable: "Campaign ads with at least 50% of the creative visible for one continuous second. This is not a unique-person count."
  };
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const status = document.getElementById("status");
  const reportRoot = document.getElementById("report");
  // format Pacific campaign dates
  const campaignDate = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "America/Los_Angeles",
    year: "numeric"
  });
  // format Pacific campaign times
  const campaignClock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles"
  });

  // exchange one fragment token
  const post = (path) => fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });

  // append one aggregate metric
  const addTotal = (label, value, helpText, benchmark) => {
    const wrapper = document.createElement("div");
    wrapper.className = "metric";
    const term = document.createElement("dt");
    const labelText = document.createElement("span");
    labelText.textContent = label;
    const help = document.createElement("details");
    help.className = "metric-help";
    const helpToggle = document.createElement("summary");
    helpToggle.setAttribute("aria-label", "About " + label);
    const helpIcon = document.createElement("img");
    helpIcon.alt = "";
    helpIcon.className = "info-icon";
    helpIcon.src = "/static/images/icons/solid/info-circle.svg";
    const tooltip = document.createElement("span");
    tooltip.className = "metric-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = helpText;
    helpToggle.append(helpIcon);
    help.append(helpToggle, tooltip);
    term.append(labelText, help);
    const detail = document.createElement("dd");
    detail.textContent = value ?? "—";
    wrapper.append(term, detail);
    // optional comparison context
    if (benchmark) {
      const comparison = document.createElement("p");
      comparison.className = "metric-benchmark";
      comparison.textContent = benchmark;
      wrapper.append(comparison);
    }
    document.getElementById("totals").append(wrapper);
  };

  // combine one campaign timestamp
  const formatCampaignTime = (value) => {
    const timestamp = new Date(value);
    return campaignDate.format(timestamp) + " · " + campaignClock.format(timestamp);
  };

  // render one aggregate report
  const renderReport = (report) => {
    document.getElementById("name").textContent = report.campaign.reportName;
    document.getElementById("campaign-meta").textContent = report.campaign.advertiserName;
    document.getElementById("campaign-start").textContent = formatCampaignTime(report.campaign.startsAt);
    document.getElementById("campaign-stop").textContent = formatCampaignTime(report.campaign.endedEarlyAt ?? report.campaign.endsAt);
    addTotal("Opportunities", report.totals.opportunityCount, METRIC_HELP.opportunities);
    addTotal("Served ads", report.totals.servedCount, METRIC_HELP.served);
    addTotal("Viewable impressions", report.totals.viewableCount, METRIC_HELP.viewable);
    addTotal("Viewability rate", report.totals.viewabilityRate, METRIC_HELP.viewabilityRate);
    addTotal("Clicks", report.totals.clickCount, METRIC_HELP.clicks);
    addTotal(
      "Click-through rate",
      report.totals.clickThroughRate,
      METRIC_HELP.clickThroughRate + " This campaign's viewable CTR is " + (report.totals.viewableClickThroughRate ?? "unavailable") + ".",
      "Typical display ads: " + DISPLAY_CTR_BASELINE
    );
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
