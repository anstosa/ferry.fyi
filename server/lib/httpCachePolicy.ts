import type { RequestHandler } from "express";

export const DISCOVERY_CACHE_CONTROL =
  "public, max-age=300, s-maxage=300, stale-while-revalidate=60";
export const NO_STORE_CACHE_CONTROL = "no-store";

const DISCOVERY_PATHS = new Set([
  "/.well-known/security.txt",
  "/llms.txt",
  "/openapi.json",
  "/robots.txt",
  "/sitemap.xml",
]);

export const classifyHttpCache = (
  pathname: string
): "discovery" | "live" | "route-owned" => {
  if (DISCOVERY_PATHS.has(pathname)) {
    return "discovery";
  }
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/ota/") &&
    pathname !== "/api/ota"
  ) {
    return "live";
  }
  return "route-owned";
};

export const httpCachePolicy: RequestHandler = (request, response, next) => {
  const classification = classifyHttpCache(request.path);
  if (classification === "discovery") {
    response.set({
      "Cache-Control": DISCOVERY_CACHE_CONTROL,
      "CDN-Cache-Control": DISCOVERY_CACHE_CONTROL,
      "Surrogate-Control": DISCOVERY_CACHE_CONTROL,
    });
  } else if (classification === "live") {
    response.set({
      "Cache-Control": NO_STORE_CACHE_CONTROL,
      "CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
      "Surrogate-Control": NO_STORE_CACHE_CONTROL,
    });
  }
  next();
};
