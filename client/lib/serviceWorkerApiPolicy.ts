export type ServiceWorkerApiPolicy = "network-only";

/**
 * API responses default to the network. Ferry FYI has no reviewed anonymous
 * response whose timestamp, UI stale-state contract, and bounded offline age
 * jointly justify persistent service-worker caching.
 */
export const getServiceWorkerApiPolicy = ({
  request,
  url,
}: {
  request: Pick<Request, "headers" | "method" | "url">;
  url: URL;
}): ServiceWorkerApiPolicy | null => {
  if (
    url.origin !== new URL(request.url).origin ||
    !url.pathname.startsWith("/api/")
  ) {
    return null;
  }
  return "network-only";
};
