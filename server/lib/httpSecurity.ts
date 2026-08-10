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

// build report policy
export const buildCspReportOnlyPolicy = (
  reportUri?: string,
  allowFraming = false
): string => {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
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
  // framing policy guard
  if (!allowFraming) {
    directives.push("frame-ancestors 'none'");
  }
  const normalizedReportUri = asReportUri(reportUri);
  if (normalizedReportUri) {
    directives.push(`report-uri ${normalizedReportUri}`);
  }
  return directives.join("; ");
};

// apply transport security
export const createHttpSecurityMiddleware = ({
  environment = process.env.NODE_ENV,
  reportUri = process.env.CSP_REPORT_URI,
}: {
  environment?: string;
  reportUri?: string;
} = {}): RequestHandler => {
  const normalizedReportUri = asReportUri(reportUri);
  const isProduction = environment === "production";
  const activateReportOnly = !isProduction || normalizedReportUri;
  return (request, response, next) => {
    response.set({
      "Permissions-Policy": "camera=(self), geolocation=(self), microphone=()",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
    });
    // production framing guard
    if (isProduction) {
      response.set({
        "Content-Security-Policy": "frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
      });
    }
    // report-only policy guard
    if (activateReportOnly) {
      response.set(
        "Content-Security-Policy-Report-Only",
        buildCspReportOnlyPolicy(normalizedReportUri, !isProduction)
      );
    }
    const protocol = request.get("x-forwarded-proto") || request.protocol;
    // production transport guard
    if (isProduction && protocol === "https") {
      response.set("Strict-Transport-Security", "max-age=15552000");
    }
    next();
  };
};
