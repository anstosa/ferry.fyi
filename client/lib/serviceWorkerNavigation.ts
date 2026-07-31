export const OFFLINE_DOCUMENT_URL = "/offline.html";

interface NavigationRouteDependencies<TStrategy> {
  matchPrecache: (url: string) => Promise<Response | undefined>;
  NetworkOnly: new (options: {
    plugins: Array<{ handlerDidError: () => Promise<Response> }>;
  }) => TStrategy;
  registerRoute: (
    match: (context: { request: Request }) => boolean,
    strategy: TStrategy
  ) => void;
}

export const registerNetworkOnlyNavigationRoute = <TStrategy>({
  matchPrecache,
  NetworkOnly,
  registerRoute,
}: NavigationRouteDependencies<TStrategy>): void => {
  registerRoute(
    ({ request }) => request.mode === "navigate",
    new NetworkOnly({
      plugins: [
        {
          handlerDidError: async () =>
            (await matchPrecache(OFFLINE_DOCUMENT_URL)) ?? Response.error(),
        },
      ],
    })
  );
};
