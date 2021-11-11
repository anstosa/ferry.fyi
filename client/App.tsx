import "./app.scss";
import { About } from "./components/About";
import { Alert } from "./components/Alert";
import { AnimatePresence } from "framer-motion";
import { Feedback } from "./components/Feedback";
import { Schedule } from "./components/Schedule";
import { Settings } from "luxon";
import { Splash } from "./components/Splash";
import { Terminal } from "shared/contracts/terminals";
import { useLocation, useNavigate, useRoutes } from "react-router-dom";
import { useOnline, useWSF } from "./lib/api";
import { useRecordPageViews } from "~/lib/analytics";
import DumpsterFireIcon from "~/images/icons/solid/dumpster-fire.svg";
import OfflineIcon from "~/images/icons/solid/signal-alt-slash.svg";
import React, { ReactElement, useEffect, useState } from "react";
import ReactGA from "react-ga";

Settings.defaultZoneName = "America/Los_Angeles";

const DEFAULT_ROUTE = "/mukilteo";

export const App = (): ReactElement => {
  useEffect(() => {
    ReactGA.initialize(process.env.GOOGLE_ANALYTICS as string);
  }, []);
  const navigate = useNavigate();
  const isOnline = useOnline();
  const isWsfOffline = useWSF().offline;
  const [offlineDismissed, setOfflineDismissed] = React.useState(false);
  const [wsfDismissed, setWsfDismissed] = React.useState(false);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [mate, setMate] = useState<Terminal | null>(null);
  useRecordPageViews();
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === "/") {
      if (terminal) {
        navigate(`/${terminal.id}/${mate?.id}`);
      } else {
        navigate(DEFAULT_ROUTE);
      }
    }
  }, [pathname]);

  const renderSchedule = (): ReactElement => (
    <Schedule onTerminalChange={setTerminal} onMateChange={setMate} />
  );

  const element = useRoutes([
    { path: "about", element: <About /> },
    { path: "feedback", element: <Feedback /> },
    {
      path: ":terminalSlug",
      element: renderSchedule(),
      children: [{ path: ":mateSlug", element: renderSchedule() }],
    },
  ]);

  if (element) {
    return (
      <>
        {element}
        <AnimatePresence>
          {!isOnline && !offlineDismissed && (
            <Alert warning onClose={() => setOfflineDismissed(true)}>
              <OfflineIcon className="inline-block ml-2" />
              Your device is offline! You can still view the schedule, but
              things may not be up to date.
            </Alert>
          )}
          {isWsfOffline && !wsfDismissed && (
            <Alert warning onClose={() => setWsfDismissed(true)}>
              <DumpsterFireIcon className="inline-block ml-2" />
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
