import "../../../client/app.scss";

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { SailingRecommendationCard } from "../../../client/views/Schedule/SailingRecommendationCard";
import { fixtureAudit, fixtureSchedule } from "./state";

// enable the class-based production dark palette on request
if (new URL(window.location.href).searchParams.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

// render the production card with observable deterministic adapters
const FixtureApp = (): React.ReactElement => {
  const [, setAuditVersion] = useState(0);
  // reflect sanitized adapter activity for manual review
  useEffect(() => {
    const handleAudit = (): void => {
      setAuditVersion((value) => value + 1);
    };
    window.addEventListener("sailing-fixture-audit", handleAudit);
    // release the fixture-only audit listener
    return () =>
      window.removeEventListener("sailing-fixture-audit", handleAudit);
  }, []);
  return (
    <main className="min-h-screen bg-white px-3 py-6 text-gray-950 dark:bg-gray-900 dark:text-white sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="px-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-800 dark:text-green-300">
            Edmonds to Kingston · browser fixture
          </p>
          <h1 className="text-2xl font-bold">Today&apos;s sailings</h1>
        </header>
        <SailingRecommendationCard schedule={fixtureSchedule} />
        <aside
          aria-label="Fixture audit"
          className="m-3 rounded border border-dashed border-gray-400 p-3 text-xs"
        >
          <strong>Fixture audit:</strong> {fixtureAudit.scenario} · API calls{" "}
          <span data-testid="api-calls">{fixtureAudit.apiCalls}</span> ·
          location requests{" "}
          <span data-testid="location-requests">
            {fixtureAudit.locationRequests}
          </span>
        </aside>
      </div>
    </main>
  );
};

const root = document.querySelector("#root");
// require one deterministic fixture mount
if (!root) {
  throw new Error("sailing recommendation fixture root unavailable");
}
createRoot(root).render(<FixtureApp />);
