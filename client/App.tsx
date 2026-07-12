import "./app.scss";
import "@capacitor/core";

import { useAuth0 } from "@auth0/auth0-react";
import { App as Native } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { AnimatePresence } from "framer-motion";
import { Settings } from "luxon";
import React, { ReactElement, useEffect } from "react";
import ReactGA from "react-ga4";
import {
  Navigate,
  useLocation,
  useNavigate,
  useRoutes,
} from "react-router-dom";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { Splash } from "~/components/Splash";
import { useRecordPageViews } from "~/lib/analytics";
import { useOnline, useWSF } from "~/lib/api";
import { useDevice } from "~/lib/device";
import { usePush } from "~/lib/push";
import { slugs } from "~/lib/terminals";
import { useUser } from "~/lib/user";
import DumpsterFireIcon from "~/static/images/icons/solid/dumpster-fire.svg";
import OfflineIcon from "~/static/images/icons/solid/signal-alt-slash.svg";
import { About } from "~/views/About";
import { Account } from "~/views/Account";
import { Feedback } from "~/views/Feedback";
import { ForecastingExplained } from "~/views/ForecastingExplained";
import { Home } from "~/views/Home";
import { Route } from "~/views/Route";
import { Tickets } from "~/views/Tickets";
import { Today } from "~/views/Today";

import { Toast } from "./components/Toast";

Settings.defaultZone = "America/Los_Angeles";

if (!process.env.AUTH0_DOMAIN) {
  throw Error("AUTH0_DOMAIN environment variable is not set");
}

export const App = (): ReactElement => {
  useEffect(() => {
    if (process.env.GOOGLE_ANALYTICS) {
      ReactGA.initialize(process.env.GOOGLE_ANALYTICS);
    }
  }, []);
  const isOnline = useOnline();
  const isWsfOffline = useWSF()?.offline ?? false;
  const [offlineDismissed, setOfflineDismissed] = React.useState(false);
  const [wsfDismissed, setWsfDismissed] = React.useState(false);
  const device = useDevice();
  useRecordPageViews();
  const navigate = useNavigate();
  const location = useLocation();
  const { handleRedirectCallback } = useAuth0();
  const [{ alertRules }] = useUser();
  const initializePush = usePush(false);
  const routeResetKey = `${location.pathname}${location.search}`;
  const routeParts = location.pathname.split("/").filter(Boolean);
  const isScheduleRoute =
    // one-terminal route
    (routeParts.length === 1 && slugs.includes(routeParts[0])) ||
    // two-terminal route
    (routeParts.length === 2 &&
      slugs.includes(routeParts[0]) &&
      slugs.includes(routeParts[1]));

  // wrap route element
  const withRouteBoundary = (
    label: string,
    routeElement: ReactElement
  ): ReactElement => (
    <ErrorBoundary
      resetKey={routeResetKey}
      fallbackTitle={`${label} crashed`}
      fallbackMessage="This page hit an unexpected error. Use the menu or footer to keep navigating."
    >
      {routeElement}
    </ErrorBoundary>
  );

  useEffect(() => {
    const hasAlertRules = (alertRules?.length ?? 0) > 0;
    // alert guard
    if (hasAlertRules) {
      initializePush();
    }
  }, [alertRules]);

  const handleCallback = async (url = window.location.href) => {
    const match = url.match(
      // eslint-disable-next-line no-useless-escape
      /^.*:\/\/[^\/]*([^\?]*)($|\?.*)/
    );
    if (!match) {
      return;
    }
    const [, pathname = "/", query = ""] = match;
    if (pathname === "/callback") {
      if (
        query.includes("state") &&
        (query.includes("code") || query.includes("error"))
      ) {
        const { appState } = await handleRedirectCallback(url);
        if (appState.redirectPath) {
          navigate(appState.redirectPath);
          return;
        }
      }
      navigate("/");
      return;
    }
    navigate(`${pathname ?? "/"}${query ?? ""}`);
  };

  useEffect(() => {
    if (device?.isNativeMobile) {
      Native.addListener("appUrlOpen", async ({ url }) => {
        await handleCallback(url);
        Browser.close();
      });
    }
  }, [handleRedirectCallback, device?.isNativeMobile]);

  Native.addListener("backButton", () => {
    navigate(-1);
  });

  useEffect(() => {
    handleCallback();
  }, [location.pathname]);

  const element = useRoutes([
    { path: "", element: withRouteBoundary("Home", <Home />) },
    { path: "today", element: withRouteBoundary("Today", <Today />) },
    { path: "callback", element: withRouteBoundary("Callback", <Splash />) },
    { path: "account", element: withRouteBoundary("Account", <Account />) },
    { path: "tickets", element: withRouteBoundary("Tickets", <Tickets />) },
    { path: "about", element: withRouteBoundary("About", <About />) },
    {
      path: "forecasting",
      element: withRouteBoundary("Forecasting", <ForecastingExplained />),
    },
    {
      path: "forecasting-explained",
      element: <Navigate replace to="/forecasting" />,
    },
    { path: "feedback", element: withRouteBoundary("Feedback", <Feedback />) },
    {
      path: ":terminalSlug",
      children: [
        {
          path: "",
          element: withRouteBoundary("Schedule", <Route view="schedule" />),
        },
        {
          path: "cameras",
          element: withRouteBoundary("Cameras", <Route view="cameras" />),
        },
        {
          path: "terminal",
          element: withRouteBoundary("Terminal", <Route view="terminal" />),
        },
        {
          path: "map",
          element: withRouteBoundary("Map", <Route view="map" />),
        },
        {
          path: "alerts",
          element: withRouteBoundary("Alerts", <Route view="alerts" />),
        },
        {
          path: "subscribe",
          element: withRouteBoundary("Alerts", <Route view="subscribe" />),
        },
        {
          path: ":mateSlug",
          children: [
            {
              path: "",
              element: withRouteBoundary("Schedule", <Route view="schedule" />),
            },
            {
              path: "cameras",
              element: withRouteBoundary("Cameras", <Route view="cameras" />),
            },
            {
              path: "terminal",
              element: withRouteBoundary("Terminal", <Route view="terminal" />),
            },
            {
              path: "map",
              element: withRouteBoundary("Map", <Route view="map" />),
            },
            {
              path: "alerts",
              element: withRouteBoundary("Alerts", <Route view="alerts" />),
            },
            {
              path: "subscribe",
              element: withRouteBoundary("Alerts", <Route view="subscribe" />),
            },
          ],
        },
      ],
    },
  ]);

  if (element) {
    return (
      <>
        {element}
        <AnimatePresence>
          {!isOnline && !offlineDismissed && (
            <Toast
              warning
              footerDocked
              onClose={() => setOfflineDismissed(true)}
              Icon={OfflineIcon}
            >
              Your device is offline! You can still view the schedule, but
              things may not be up to date.
            </Toast>
          )}
          {isScheduleRoute && isWsfOffline && !wsfDismissed && (
            <Toast
              warning
              footerDocked
              onClose={() => setWsfDismissed(true)}
              Icon={DumpsterFireIcon}
            >
              WSF web services are offline! You can still use the app but things
              may not be up to date.
            </Toast>
          )}
        </AnimatePresence>
      </>
    );
  } else {
    return <Splash />;
  }
};
