import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { AutomaticCheckinsInstallBanner } from "../../../client/components/AutomaticCheckinsInstallBanner";
import { LeaderboardAutomaticEnrollment } from "../../../client/components/LeaderboardAutomaticEnrollment";

import { automaticFixtureState, bindAutomaticFixtureRender } from "./state";
import "./capacitor";

import "../../../client/app.scss";

// render the production automatic enrollment surface with deterministic adapters
const FixtureApp = (): React.ReactElement => {
  const [, setVersion] = useState(0);
  const [preferences, setPreferences] = useState(
    automaticFixtureState.preferences
  );
  // commit one stable visible preference callback
  const handlePreferencesChange = useCallback((next: typeof preferences) => {
    automaticFixtureState.preferences = next;
    setPreferences(next);
  }, []);
  // rerender after one externally controlled fixture update
  bindAutomaticFixtureRender(() => {
    setPreferences({ ...automaticFixtureState.preferences });
    // advance one fixture render
    setVersion((current) => current + 1);
  });
  return (
    <MemoryRouter>
      <AutomaticCheckinsInstallBanner />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-bold">
          Automatic check-in browser fixture
        </h1>
        <LeaderboardAutomaticEnrollment
          disabled={false}
          onPreferencesChange={handlePreferencesChange}
          preferences={preferences}
        />
        <nav aria-label="Manual check-in fallback" className="mt-6 flex gap-3">
          <a className="button" href="/leaderboards/terminals/7">
            Manual terminal check-in
          </a>
          <a className="button" href="/leaderboards/vessels/fixture-vessel">
            Manual vessel check-in
          </a>
        </nav>
      </main>
    </MemoryRouter>
  );
};

// locate one fixture mount root
const root = document.querySelector("#root");
// require one deterministic fixture mount
if (!root) {
  throw new Error("automatic fixture root unavailable");
}
createRoot(root).render(<FixtureApp />);
