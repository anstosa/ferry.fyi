import "./app.scss";
import { About } from "./views/About";
import { AnimatePresence } from "framer-motion";
import { Feedback } from "./views/Feedback";
import { Home } from "./views/Home";
import { Notification } from "./components/Notification";
import { Route } from "./views/Route";
import { Settings } from "luxon";
import { Splash } from "./components/Splash";
import { useOnline, useWSF } from "./lib/api";
import { useRecordPageViews } from "~/lib/analytics";
import { useRoutes } from "react-router-dom";
import DumpsterFireIcon from "~/images/icons/solid/dumpster-fire.svg";
import OfflineIcon from "~/images/icons/solid/signal-alt-slash.svg";
import React, { ReactElement, useEffect } from "react";
import ReactGA from "react-ga4";

Settings.defaultZoneName = "America/Los_Angeles";

export const App = (): ReactElement => {
  useEffect(() => {
    ReactGA.initialize(process.env.GOOGLE_ANALYTICS as string);
  }, []);
  const isOnline = useOnline();
  const isWsfOffline = useWSF().offline;
  const [offlineDismissed, setOfflineDismissed] = React.useState(false);
  const [wsfDismissed, setWsfDismissed] = React.useState(false);
  useRecordPageViews();

  const element = useRoutes([
    { path: "", element: <Home /> },
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
