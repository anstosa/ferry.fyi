import "./app.scss";
import "@capacitor/core";
import { About } from "./views/About";
import { Account } from "./views/Account";
import { AnimatePresence } from "framer-motion";
import { colors } from "~/lib/theme";
import { Feedback } from "./views/Feedback";
import { Home } from "./views/Home";
import { App as Native } from "@capacitor/app";
import { Notification } from "./components/Notification";
import { Route } from "./views/Route";
import { Settings } from "luxon";
import { Splash } from "./components/Splash";
import { StatusBar } from "@capacitor/status-bar";
import { Tickets } from "./views/Tickets";
import { useDevice } from "./lib/device";
import { useNavigate, useRoutes } from "react-router-dom";
import { useOnline, useWSF } from "./lib/api";
import { useRecordPageViews } from "~/lib/analytics";
import DumpsterFireIcon from "~/static/images/icons/solid/dumpster-fire.svg";
import OfflineIcon from "~/static/images/icons/solid/signal-alt-slash.svg";
import React, { ReactElement, useEffect } from "react";
import ReactGA from "react-ga4";

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
  const isWsfOffline = useWSF().offline;
  const [offlineDismissed, setOfflineDismissed] = React.useState(false);
  const [wsfDismissed, setWsfDismissed] = React.useState(false);
  const device = useDevice();
  useRecordPageViews();
  const navigate = useNavigate();

  useEffect(() => {
    if (device?.platform === "android" || device?.platform === "ios") {
      StatusBar.setBackgroundColor({ color: colors.green.dark });
    }
  }, [device?.platform]);

  Native.addListener("backButton", () => {
    navigate(-1);
  });

  const element = useRoutes([
    { path: "", element: <Home /> },
    { path: "account", element: <Account /> },
    { path: "tickets", element: <Tickets /> },
    { path: "about", element: <About /> },
    { path: "feedback", element: <Feedback /> },
    {
      path: ":terminalSlug",
      children: [
        { path: "", element: <Route view="schedule" /> },
        { path: "cameras", element: <Route view="cameras" /> },
        { path: "map", element: <Route view="map" /> },
        { path: "alerts", element: <Route view="alerts" /> },
        {
          path: ":mateSlug",
          children: [
            { path: "", element: <Route view="schedule" /> },
            { path: "cameras", element: <Route view="cameras" /> },
            { path: "map", element: <Route view="map" /> },
            { path: "alerts", element: <Route view="alerts" /> },
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
            <Notification
              warning
              onClose={() => setOfflineDismissed(true)}
              Icon={OfflineIcon}
            >
              Your device is offline! You can still view the schedule, but
              things may not be up to date.
            </Notification>
          )}
          {isWsfOffline && !wsfDismissed && (
            <Notification
              warning
              onClose={() => setWsfDismissed(true)}
              Icon={DumpsterFireIcon}
            >
              WSF web services are offline! You can still use the app but things
              may not be up to date.
            </Notification>
          )}
        </AnimatePresence>
      </>
    );
  } else {
    return <Splash />;
  }
};
