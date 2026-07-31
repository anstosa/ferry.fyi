import React, {
  createContext,
  type PropsWithChildren,
  useContext,
} from "react";

export type AppRuntime = "browser" | "hydrate" | "server";

export interface AppRenderContextValue {
  clock: () => number;
  hasInjectedRequest: boolean;
  platform: "android" | "ios" | "web";
  requestUrl: string;
  runtime: AppRuntime;
  seoBaseUrl: string;
  seoHost: string;
  seoPathname: string;
}

const defaultRenderContext: AppRenderContextValue = {
  // Browser-only callers that have not mounted an explicit render boundary
  // retain their live clock; AppRoot always supplies a fixed request clock.
  clock: () => Date.now(),
  hasInjectedRequest: false,
  platform: "web",
  requestUrl: "http://localhost/",
  runtime: "server",
  seoBaseUrl: "",
  seoHost: "",
  seoPathname: "/",
};

export const AppRenderContext =
  createContext<AppRenderContextValue>(defaultRenderContext);

export const AppRenderProvider = ({
  children,
  value,
}: PropsWithChildren<{ value: AppRenderContextValue }>) => (
  <AppRenderContext.Provider value={value}>
    {children}
  </AppRenderContext.Provider>
);

export const useAppRenderContext = (): AppRenderContextValue =>
  useContext(AppRenderContext);
