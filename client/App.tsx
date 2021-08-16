import "./app.scss";
import { Redirect, Route } from "react-router-dom";
import { Schedule } from "./Schedule/Schedule";
import { Settings } from "luxon";
import { useRecordPageViews } from "~/lib/analytics";
import React, { FC, useEffect } from "react";
import ReactGA from "react-ga";

Settings.defaultZoneName = "America/Los_Angeles";

const DEFAULT_ROUTE = "/mukilteo";

export const App: FC = () => {
  useEffect(() => {
    ReactGA.initialize(process.env.GOOGLE_ANALYTICS as string);
  }, []);

  useRecordPageViews();

  return (
    <div className="selection:bg-white selection:green-dark">
      <Route path="/:terminalSlug/:mateSlug?" component={Schedule} />
      <Route
        path="/"
        exact
        render={() => <Redirect to={{ pathname: DEFAULT_ROUTE }} />}
      />
    </div>
  );
};
