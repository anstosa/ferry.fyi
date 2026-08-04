import type { RequestHandler } from "express";

const asReportUri = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

export const buildCspReportOnlyPolicy = (reportUri?: string): string => {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https:",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "frame-src 'self' https:",
    "manifest-src 'self'",
  ];
  const normalizedReportUri = asReportUri(reportUri);
  if (normalizedReportUri) {
    directives.push(`report-uri ${normalizedReportUri}`);
  }
  return directives.join("; ");
};

export const createHttpSecurityMiddleware = ({
  environment = process.env.NODE_ENV,
  reportUri = process.env.CSP_REPORT_URI,
}: {
  environment?: string;
  reportUri?: string;
} = {}): RequestHandler => {
  const normalizedReportUri = asReportUri(reportUri);
  const activateReportOnly =
    environment !== "production" || normalizedReportUri;
  return (request, response, next) => {
    response.set({
      "Permissions-Policy": "camera=(self), geolocation=(self), microphone=()",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    if (activateReportOnly) {
      response.set(
        "Content-Security-Policy-Report-Only",
        buildCspReportOnlyPolicy(normalizedReportUri)
      );
    }
    const protocol = request.get("x-forwarded-proto") || request.protocol;
    if (environment === "production" && protocol === "https") {
      response.set("Strict-Transport-Security", "max-age=15552000");
    }
    next();
  };
};
