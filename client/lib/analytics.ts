import { useEffect } from "react";
import type ReactGA from "react-ga4";
import { useLocation } from "react-router-dom";

const contentSurfaces = ["schedule", "cameras", "bulletins", "fare"] as const;
const shareSurfaces = [
  ...contentSurfaces,
  "terminal",
  "map",
  "sailing",
  "trip_plan",
  "leaderboard",
] as const;
export type UsefulContentSurface = (typeof contentSurfaces)[number];
export type ShareSurface = (typeof shareSurfaces)[number];

const productSchemas = {
  useful_visit: {},
  useful_content_view: { surface: contentSurfaces },
  install_prompt: { result: ["opened", "accepted", "dismissed"] },
  install_store_opened: { store: ["apple", "google"] },
  pwa_install_completed: {},
  alert_saved: { kind: ["recurring", "one_time"] },
  share_completed: {
    surface: shareSurfaces,
    method: ["share_sheet", "clipboard"],
  },
  trip_plan_available: {
    travel_mode: ["drive", "walk", "bicycle", "transit"],
    result: ["recommended", "timing_only"],
  },
  fare_quote_available: { freshness: ["current", "stale"] },
} as const;
type ProductEventName = keyof typeof productSchemas;
type Schema = typeof productSchemas;
type EnumValue<T> = T extends readonly string[] ? T[number] : never;
type ProductParams<N extends ProductEventName> = {
  [K in keyof Schema[N]]: EnumValue<Schema[N][K]>;
};
type ProductArgs<N extends ProductEventName> =
  keyof ProductParams<N> extends never
    ? [params?: Record<string, never>]
    : [params: ProductParams<N>];
type IntentEventName = "install_prompt" | "install_store_opened";
type UsefulEventName = Exclude<
  ProductEventName,
  "useful_visit" | "install_prompt" | "install_store_opened"
>;
type SafeContext = {
  page_location: string;
  page_referrer: string;
  page_title: string;
  send_to: string;
};
type AnalyticsEvent = (
  | { action: "event"; category: "Navigation"; label: string }
  | { action: "pageview"; pathname: string }
  | {
      action: "product";
      name: ProductEventName;
      params: Record<string, string>;
    }
) & { context: SafeContext };
type GoogleAnalytics = typeof ReactGA;

const queuedEvents: AnalyticsEvent[] = [];
const engagementEvents = ["keydown", "pointerdown", "scroll", "touchstart"];
const googleConsentDefaults = {
  ad_personalization: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  analytics_storage: "granted",
} as const;
const googleAdvertisingFeatureDefaults = {
  allow_ad_personalization_signals: false,
  allow_google_signals: false,
} as const;
let analyticsActivated = false;
let analyticsPrepared = false;
let analyticsPromise: Promise<GoogleAnalytics | null> | null = null;
let removeEngagementListeners: (() => void) | null = null;

// capture only public route context at occurrence
const safeContext = (): SafeContext => ({
  page_location: `${window.location.origin}${window.location.pathname}`,
  page_referrer: "",
  page_title: "Ferry FYI",
  send_to: process.env.GOOGLE_ANALYTICS ?? "",
});

// reject unknown names and fields before any queue or provider access
const validateProductEvent = (
  name: ProductEventName,
  params: unknown
): Record<string, string> | null => {
  // reject names outside the closed catalog
  if (typeof name !== "string" || !Object.hasOwn(productSchemas, name)) {
    return null;
  }
  const schema: Record<string, readonly string[]> = productSchemas[name];
  const values = params === undefined ? {} : params;
  // accept only an exact parameter object
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(values);
  // reject class instances and every extra own key, including symbols
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(values).length !== Object.keys(schema).length
  ) {
    return null;
  }
  const entries = Object.entries(Object.getOwnPropertyDescriptors(values));
  // reject missing required fields
  if (entries.length !== Object.keys(schema).length) {
    return null;
  }
  const result: Record<string, string> = {};
  // copy only validated fixed enums
  for (const [key, descriptor] of entries) {
    const { value }: { value?: unknown } = descriptor;
    // reject unknown keys and non-enum values
    if (
      !Object.hasOwn(schema, key) ||
      typeof value !== "string" ||
      !schema[key].includes(value)
    ) {
      return null;
    }
    result[key] = value;
  }
  return result;
};

// retain only the existing legacy tag-manager compatibility paths
const pushDataLayerEvent = (event: AnalyticsEvent): void => {
  window.dataLayer = window.dataLayer ?? [];
  // product events use only the direct named transport
  if (event.action === "product") {
    return;
  }
  // retain explicit pathname pageviews
  if (event.action === "pageview") {
    window.dataLayer.push({
      event: "page_view",
      page_path: event.pathname,
      ...event.context,
    });
    return;
  }
  window.dataLayer.push({
    event: "ferry_fyi_event",
    event_action: event.label,
    event_category: event.category,
    ...event.context,
  });
};

// send immutable event-scoped context rather than mutable global defaults
const reportToGoogleAnalytics = (
  ReactGA: GoogleAnalytics,
  event: AnalyticsEvent
): void => {
  // preserve explicit pageview behavior
  if (event.action === "pageview") {
    ReactGA.send({
      hitType: "pageview",
      page: event.pathname,
      ...event.context,
    });
    return;
  }
  // preserve legacy category and action with scoped privacy fields
  if (event.action === "event") {
    ReactGA.event(event.label, {
      event_category: event.category,
      ...event.context,
    });
    return;
  }
  ReactGA.event(event.name, { ...event.params, ...event.context });
};

// load analytics without implicit pageviews or advertising features
const loadGoogleAnalytics = async (): Promise<GoogleAnalytics | null> => {
  const measurementId = process.env.GOOGLE_ANALYTICS;
  // missing configuration must not affect the rider
  if (!measurementId) {
    return null;
  }
  const { default: ReactGA } = await import("react-ga4");
  ReactGA.initialize(measurementId, {
    gtagOptions: { ...safeContext(), send_page_view: false },
    gaOptions: {
      allowAdFeatures: false,
      allowAdPersonalizationSignals: false,
    },
  });
  return ReactGA;
};

// prepare privacy defaults exactly once before either tag loads
const prepareAnalytics = (): void => {
  // strict-mode replay must not duplicate preparation
  if (analyticsPrepared) {
    return;
  }
  analyticsPrepared = true;
  window.dataLayer = window.dataLayer ?? [];
  // preserve the google arguments-object command format
  const gtag: (...values: unknown[]) => void = function (): void {
    // google tag requires arguments-object commands
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  gtag("consent", "default", googleConsentDefaults);
  gtag("set", { ...googleAdvertisingFeatureDefaults, ...safeContext() });
  const containerId = process.env.GTM_CONTAINER_ID;
  // omit the tag-manager marker when unconfigured
  if (!containerId) {
    return;
  }
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
};

// drain in occurrence order and isolate provider failures
const flushEvents = async (): Promise<void> => {
  const ReactGA = await analyticsPromise;
  const events = queuedEvents.splice(0);
  // discard unsupported transport events without retaining an offline queue
  if (!ReactGA) {
    return;
  }
  // one broken provider call must not block subsequent rider actions
  for (const event of events) {
    try {
      reportToGoogleAnalytics(ReactGA, event);
    } catch {
      // analytics remains best effort
    }
  }
};

// activate on engagement or a truthful useful outcome
const activateAnalytics = (): void => {
  // keep tag loading idempotent
  if (analyticsActivated) {
    return;
  }
  analyticsActivated = true;
  removeEngagementListeners?.();
  prepareAnalytics();
  const containerId = process.env.GTM_CONTAINER_ID;
  // preserve deferred tag-manager loading
  if (containerId) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`;
    document.head.append(script);
  }
  analyticsPromise = loadGoogleAnalytics().catch(() => null);
  flushEvents().catch(() => undefined);
};

// queue complete occurrences without splitting adjacent useful pairs
const enqueue = (...events: AnalyticsEvent[]): void => {
  queuedEvents.push(...events);
  // flush later occurrences after activation without reloading tags
  if (analyticsActivated) {
    flushEvents().catch(() => undefined);
  }
};

// defer nonqualifying analytics until engagement
export const deferAnalytics = (): (() => void) => {
  // avoid server work and duplicate active listeners
  if (
    typeof window === "undefined" ||
    analyticsActivated ||
    removeEngagementListeners
  ) {
    return () => undefined;
  }
  prepareAnalytics();
  // remove this exact listener group on activation or cleanup
  const cleanup = (): void => {
    // detach all supported engagement triggers
    for (const event of engagementEvents) {
      window.removeEventListener(event, activateAnalytics);
    }
    removeEngagementListeners = null;
  };
  removeEngagementListeners = cleanup;
  // retain existing engagement activation policy
  for (const event of engagementEvents) {
    window.addEventListener(event, activateAnalytics, {
      once: true,
      passive: true,
    });
  }
  return cleanup;
};

// retain only known navigation pairs at the legacy boundary
export const trackEvent = (category: string, label: string): void => {
  // reject arbitrary legacy strings and server-side calls
  if (
    typeof window === "undefined" ||
    category !== "Navigation" ||
    !["Open Menu", "Close Menu", "Swap Terminals"].includes(label)
  ) {
    return;
  }
  const event: AnalyticsEvent = {
    action: "event",
    category,
    label,
    context: safeContext(),
  };
  prepareAnalytics();
  pushDataLayerEvent(event);
  enqueue(event);
};

// record fixed nonqualifying intent without inventing rider value
export const trackProductEvent = <N extends IntentEventName>(
  name: N,
  ...[params]: ProductArgs<N>
): void => {
  // omit server-side events and reject orphan qualifiers through unsafe callers
  if (
    typeof window === "undefined" ||
    !["install_prompt", "install_store_opened"].includes(name)
  ) {
    return;
  }
  const validated = validateProductEvent(name, params);
  // reject invalid payloads before activation
  if (!validated) {
    return;
  }
  enqueue({
    action: "product",
    name,
    params: validated,
    context: safeContext(),
  });
};

// emit every truthful outcome and let ga sessions aggregate visits
export const trackUsefulEvent = <N extends UsefulEventName>(
  name: N,
  ...[params]: ProductArgs<N>
): void => {
  // omit server-side and nonqualifying names even through unsafe callers
  if (
    typeof window === "undefined" ||
    ["useful_visit", "install_prompt", "install_store_opened"].includes(name)
  ) {
    return;
  }
  const validated = validateProductEvent(name, params);
  // reject invalid payloads without initializing providers
  if (!validated) {
    return;
  }
  const context = safeContext();
  enqueue(
    { action: "product", name, params: validated, context },
    { action: "product", name: "useful_visit", params: {}, context }
  );
  activateAnalytics();
};

// capture explicit pathname pageviews before deferred transport
const trackPageView = (pathname: string): void => {
  const event: AnalyticsEvent = {
    action: "pageview",
    pathname,
    context: safeContext(),
  };
  prepareAnalytics();
  pushDataLayerEvent(event);
  enqueue(event);
};

// preserve route-only pageview tracking
export const useRecordPageViews = (): void => {
  const { pathname } = useLocation();
  // track actual pathname transitions
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
};
