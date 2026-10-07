import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  deferAnalytics,
  trackUsefulEvent,
  useRecordPageViews,
} from "../../../client/lib/analytics";
import { useUsefulContent } from "../../../client/lib/usefulVisits";

// capture the synthetic boundary mode before sanitizing fixture navigation
const boundary = new URLSearchParams(window.location.search).has("boundary");

window.history.replaceState(
  null,
  "",
  "/route-a?private=UV_PRIVATE_ORIGIN_7f83#tripAddress=UV_PRIVATE_ORIGIN_7f83"
);
document.title = "UV_PRIVATE_TITLE_04be";

// mount a meaningful real node around the production exposure hook
const Content = () => {
  const ref = useUsefulContent("schedule", "schedule:3-7-2026-10-07", true);
  const style: React.CSSProperties = { padding: 40, background: "#e9f3f6" };
  // start exactly at the viewport edge for the native observer regression
  if (boundary) {
    style.position = "absolute";
    style.top = "100vh";
    style.height = 100;
  }
  return (
    <section ref={ref} style={style}>
      Usable ferry schedule
    </section>
  );
};
// expose only synthetic actions and safe analytics commands
const Fixture = () => {
  const [mounted, setMounted] = useState(true);
  useRecordPageViews();
  // preserve production deferred initialization behavior under strict-mode replay
  useEffect(() => deferAnalytics(), []);
  // qualify only a fulfilled modeled action
  const share = async (success: boolean): Promise<void> => {
    try {
      await (success
        ? Promise.resolve()
        : Promise.reject(new Error("canceled")));
      trackUsefulEvent("share_completed", {
        surface: "schedule",
        method: "clipboard",
      });
    } catch {
      // rejected modeled actions remain silent
    }
  };
  return (
    <main>
      <h1>Useful visits test fixture</h1>
      <button id="toggle" onClick={() => setMounted((value) => !value)}>
        Toggle content
      </button>
      <button id="resolved" onClick={() => void share(true)}>
        Resolved share
      </button>
      <button id="rejected" onClick={() => void share(false)}>
        Rejected share
      </button>
      {mounted && <Content />}
    </main>
  );
};
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Fixture />
    </BrowserRouter>
  </StrictMode>
);
