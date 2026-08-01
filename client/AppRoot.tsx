import React, { type ReactElement } from "react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import type { PublicSsrSnapshot } from "shared/contracts/ssr";

import { disabledFlags, FeatureFlagContext } from "./lib/featureFlagContext";
import {
  type AppRenderContextValue,
  AppRenderProvider,
} from "./lib/renderContext";
import { PublicSsrSeedProvider } from "./lib/ssrSeed";
import { anonymousUser, UserContext } from "./lib/userContext";
import { UniversalRoutes } from "./routes";

export interface AppRootProps {
  context: Omit<AppRenderContextValue, "hasInjectedRequest">;
  helmetContext?: Record<string, unknown>;
  /** Validated by the server boundary before it reaches the render tree. */
  snapshot?: PublicSsrSnapshot;
}

export const AppFrame = ({
  children,
  context,
  helmetContext,
  snapshot,
}: React.PropsWithChildren<AppRootProps>): ReactElement => {
  const renderContext: AppRenderContextValue = {
    ...context,
    hasInjectedRequest: true,
  };
  return (
    <AppRenderProvider value={renderContext}>
      <PublicSsrSeedProvider snapshot={snapshot}>
        <FeatureFlagContext.Provider value={disabledFlags}>
          <UserContext.Provider value={anonymousUser}>
            <HelmetProvider context={helmetContext}>
              <div
                className="flex h-full min-h-0 flex-col"
                data-app-transition-shell="true"
              >
                {children}
              </div>
            </HelmetProvider>
          </UserContext.Provider>
        </FeatureFlagContext.Provider>
      </PublicSsrSeedProvider>
    </AppRenderProvider>
  );
};

/**
 * Browser-neutral composition for document rendering and hydration. Browser
 * integrations deliberately remain in clientRuntime.tsx and browserApp.tsx.
 */
export const AppRoot = ({
  context,
  helmetContext,
  snapshot,
}: AppRootProps): ReactElement => {
  const url = new URL(context.requestUrl);
  const location = `${url.pathname}${url.search}${url.hash}`;

  return (
    <AppFrame
      context={context}
      helmetContext={helmetContext}
      snapshot={snapshot}
    >
      <MemoryRouter initialEntries={[location]}>
        <UniversalRoutes />
      </MemoryRouter>
    </AppFrame>
  );
};
