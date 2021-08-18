import "./app.scss";
import { Redirect, Route } from "react-router-dom";
import { Schedule } from "./components/Schedule";
import { Settings } from "luxon";
import { useRecordPageViews } from "~/lib/analytics";
import React, { ReactElement, useEffect } from "react";
import ReactGA from "react-ga";

Settings.defaultZoneName = "America/Los_Angeles";

const DEFAULT_ROUTE = "/mukilteo";

export const App = (): ReactElement => {
  useEffect(() => {
    ReactGA.initialize(process.env.GOOGLE_ANALYTICS as string);
  }, []);

  useRecordPageViews();

  return (
    <>
      <Route path="/:terminalSlug/:mateSlug?" component={Schedule} />
      <Route
        path="/"
        exact
        render={() => <Redirect to={{ pathname: DEFAULT_ROUTE }} />}
      />
    </>
  );
};
