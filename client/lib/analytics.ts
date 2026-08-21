import { useEffect } from "react";
import type ReactGA from "react-ga4";
import { useLocation } from "react-router-dom";

type AnalyticsEvent =
  | { action: "event"; category: string; label: string }
  | { action: "pageview"; pathname: string };
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
let analyticsDeferred = false;
let analyticsPromise: Promise<GoogleAnalytics | null> | null = null;

const pushDataLayerEvent = (event: AnalyticsEvent): void => {
  window.dataLayer = window.dataLayer ?? [];
  if (event.action === "pageview") {
    window.dataLayer.push({
      event: "page_view",
      page_path: event.pathname,
    });
    return;
  }
  window.dataLayer.push({
    event: "ferry_fyi_event",
    event_action: event.label,
    event_category: event.category,
  });
};

const reportToGoogleAnalytics = (
  ReactGA: GoogleAnalytics,
  event: AnalyticsEvent
): void => {
  if (event.action === "pageview") {
    ReactGA.set({ page: event.pathname });
    ReactGA.send({ hitType: "pageview", page: event.pathname });
    return;
  }
  ReactGA.event({ category: event.category, action: event.label });
};

// load analytics without advertising features
const loadGoogleAnalytics = async (): Promise<GoogleAnalytics | null> => {
  const measurementId = process.env.GOOGLE_ANALYTICS;
  if (!measurementId) {
    return null;
  }
  const { default: ReactGA } = await import("react-ga4");

  ReactGA.initialize(measurementId, {
    gaOptions: {
      allowAdFeatures: false,
      allowAdPersonalizationSignals: false,
    },
  });
  return ReactGA;
};

// deny google advertising data use before any tag loads
const setDefaultGoogleConsent = (): void => {
  window.dataLayer = window.dataLayer ?? [];
  // preserve the gtag arguments-object command format
  const gtag: (...values: unknown[]) => void = function (): void {
    // google tag requires arguments-object commands
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  gtag("consent", "default", googleConsentDefaults);
  gtag("set", googleAdvertisingFeatureDefaults);
};

// prepare consent before the deferred tag manager load
const prepareGoogleTagManager = (): void => {
  setDefaultGoogleConsent();
  const containerId = process.env.GTM_CONTAINER_ID;
  if (!containerId) {
    return;
  }
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
};

const loadGoogleTagManager = (): void => {
  const containerId = process.env.GTM_CONTAINER_ID;
  if (!containerId) {
    return;
  }
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`;
  document.head.append(script);
};

const activateAnalytics = (): void => {
  if (analyticsActivated) {
    return;
  }
  analyticsActivated = true;
  loadGoogleTagManager();
  analyticsPromise = loadGoogleAnalytics();
  analyticsPromise
    .then((ReactGA) => {
      if (!ReactGA) {
        return;
      }
      queuedEvents
        .splice(0)
        .forEach((event) => reportToGoogleAnalytics(ReactGA, event));
    })
    .catch(() => undefined);
};

/** Queue analytics until the visitor engages with the app. */
export const deferAnalytics = (): (() => void) => {
  if (analyticsDeferred || typeof window === "undefined") {
    return () => undefined;
  }
  analyticsDeferred = true;
  prepareGoogleTagManager();
  const activateOnEngagement = (): void => {
    engagementEvents.forEach((event) =>
      window.removeEventListener(event, activateOnEngagement)
    );
    activateAnalytics();
  };
  engagementEvents.forEach((event) =>
    window.addEventListener(event, activateOnEngagement, {
      once: true,
      passive: true,
    })
  );
  return () => {
    engagementEvents.forEach((event) =>
      window.removeEventListener(event, activateOnEngagement)
    );
    analyticsDeferred = false;
  };
};

export const trackEvent = (category: string, label: string): void => {
  const event: AnalyticsEvent = { action: "event", category, label };
  pushDataLayerEvent(event);
  if (!analyticsActivated) {
    queuedEvents.push(event);
    return;
  }
  analyticsPromise
    ?.then((ReactGA) => ReactGA && reportToGoogleAnalytics(ReactGA, event))
    .catch(() => undefined);
};

const trackPageView = (pathname: string): void => {
  const event: AnalyticsEvent = { action: "pageview", pathname };
  pushDataLayerEvent(event);
  if (!analyticsActivated) {
    queuedEvents.push(event);
    return;
  }
  analyticsPromise
    ?.then((ReactGA) => ReactGA && reportToGoogleAnalytics(ReactGA, event))
    .catch(() => undefined);
};

export const useRecordPageViews = (): void => {
  const { pathname } = useLocation();
  // route tracking
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
};
