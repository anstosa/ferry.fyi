import express, { type Request, type RequestHandler, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { isObject } from "shared/lib/objects";

import {
  campaignReportCsv,
  getSharedAdCampaignReport,
} from "~/lib/admin/adCampaigns";

const reportUrl = (): URL => {
  const configured = process.env.REPORT_BASE_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("REPORT_BASE_URL is required");
  }
  const url = new URL(configured ?? "http://reports.localhost:4040");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("REPORT_BASE_URL must use HTTPS in production");
  }
  let appOrigin: string | null = null;
  try {
    appOrigin = process.env.BASE_URL
      ? new URL(process.env.BASE_URL).origin
      : null;
  } catch {
    // BASE_URL validation belongs to the main server configuration boundary.
  }
  if (url.origin === appOrigin) {
    throw new Error("REPORT_BASE_URL must use a dedicated origin");
  }
  return url;
};

const isReportHost = (request: Request): boolean =>
  request.get("host")?.toLowerCase() === reportUrl().host.toLowerCase();

const requireReportHost: RequestHandler = (request, _response, next) => {
  if (!isReportHost(request)) {
    next("route");
    return;
  }
  next();
};

const applyReportHeaders = (response: express.Response): void => {
  response.set({
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "Surrogate-Control": "no-store",
    "X-Robots-Tag": "noindex, noarchive, nofollow",
  });
};

const reportHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ferry FYI campaign report</title></head>
<body><main><h1>Ferry FYI campaign report</h1><p id="status">Loading aggregate campaign report…</p><section id="report" hidden><h2 id="name"></h2><p id="methodology"></p><dl id="totals"></dl><table><thead><tr><th>Date</th><th>Opportunities</th><th>Served</th><th>Viewable</th><th>Clicks</th></tr></thead><tbody id="daily"></tbody></table><button id="download" type="button">Download CSV</button></section></main><script defer src="/report.js"></script></body></html>`;

const reportScript = `(() => {
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const status = document.getElementById("status");
  const reportRoot = document.getElementById("report");
  const post = (path) => fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({token})});
  const addTotal = (label, value) => { const dt = document.createElement("dt"); dt.textContent = label; const dd = document.createElement("dd"); dd.textContent = value ?? "—"; document.getElementById("totals").append(dt, dd); };
  post("/report-data").then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((report) => {
    document.getElementById("name").textContent = report.campaign.reportName;
    document.getElementById("methodology").textContent = report.methodology;
    addTotal("Opportunities", report.totals.opportunityCount); addTotal("Served ads", report.totals.servedCount); addTotal("Viewable impressions", report.totals.viewableCount); addTotal("Viewability rate", report.totals.viewabilityRate); addTotal("Clicks", report.totals.clickCount); addTotal("Clicks per viewable impression", report.totals.clickThroughRate);
    const body = document.getElementById("daily"); report.daily.forEach((row) => { const tr = document.createElement("tr"); [row.businessDate, row.opportunityCount, row.servedCount, row.viewableCount, row.clickCount].forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.append(td); }); body.append(tr); });
    status.textContent = "Aggregate report"; reportRoot.hidden = false;
  }).catch(() => { status.textContent = "This report link is invalid or has been revoked."; });
  document.getElementById("download").addEventListener("click", () => post("/report-export").then((response) => { if (!response.ok) throw new Error(); return response.blob(); }).then((blob) => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ferry-fyi-campaign-report.csv"; link.click(); URL.revokeObjectURL(link.href); }).catch(() => undefined));
})();`;

export const createAdReportRouter = (): Router => {
  reportUrl();
  const router = Router();
  const limiter = rateLimit({
    identifier: "ad-report-access",
    legacyHeaders: false,
    limit: 30,
    standardHeaders: "draft-8",
    windowMs: 60_000,
  });
  const json = express.json({ limit: "4kb" });
  router.get("/", requireReportHost, (_request, response) => {
    applyReportHeaders(response);
    response.type("text/html").send(reportHtml);
  });
  router.get("/report.js", requireReportHost, (_request, response) => {
    applyReportHeaders(response);
    response.type("application/javascript").send(reportScript);
  });
  router.post(
    "/report-data",
    requireReportHost,
    json,
    limiter,
    async (request, response) => {
      applyReportHeaders(response);
      if (!isObject(request.body)) {
        response.status(404).send({ error: "resource_not_found" });
        return;
      }
      const report = await getSharedAdCampaignReport(request.body.token);
      if (!report) {
        response.status(404).send({ error: "resource_not_found" });
        return;
      }
      response.send(report);
    }
  );
  router.post(
    "/report-export",
    requireReportHost,
    json,
    limiter,
    async (request, response) => {
      applyReportHeaders(response);
      const report = isObject(request.body)
        ? await getSharedAdCampaignReport(request.body.token)
        : null;
      if (!report) {
        response.status(404).type("text/plain").send("Not found");
        return;
      }
      response
        .type("text/csv")
        .attachment("ferry-fyi-campaign-report.csv")
        .send(campaignReportCsv(report));
    }
  );
  router.use((request, response, next) => {
    if (!isReportHost(request)) {
      next();
      return;
    }
    applyReportHeaders(response);
    response.status(404).type("text/plain").send("Not found");
  });
  return router;
};
