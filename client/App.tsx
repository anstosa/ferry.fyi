import "./app.scss";
import { About } from "./components/About";
import { Alert } from "./components/Alert";
import { AnimatePresence } from "framer-motion";
import { Feedback } from "./components/Feedback";
import { Home } from "./components/Home";
import { Schedule } from "./components/Schedule";
import { Settings } from "luxon";
import { Splash } from "./components/Splash";
import { useOnline, useWSF } from "./lib/api";
import { useRecordPageViews } from "~/lib/analytics";
import { useRoutes } from "react-router-dom";
import DumpsterFireIcon from "~/images/icons/solid/dumpster-fire.svg";
import OfflineIcon from "~/images/icons/solid/signal-alt-slash.svg";
import React, { ReactElement, useEffect } from "react";
import ReactGA from "react-ga";

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
      element: <Schedule />,
      children: [{ path: ":mateSlug", element: <Schedule /> }],
    },
  ]);

  if (element) {
    return (
      <>
        {element}
        <AnimatePresence>
          {!isOnline && !offlineDismissed && (
            <Alert
              warning
              onClose={() => setOfflineDismissed(true)}
              Icon={OfflineIcon}
            >
              Your device is offline! You can still view the schedule, but
              things may not be up to date.
            </Alert>
          )}
          {isWsfOffline && !wsfDismissed && (
            <Alert
              warning
              onClose={() => setWsfDismissed(true)}
              Icon={DumpsterFireIcon}
            >
              WSF web services are offline! You can still use the app but things
              may not be up to date.
            </Alert>
          )}
        </AnimatePresence>
      </>
    );
  } else {
    return <Splash />;
  }
};
