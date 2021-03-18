import { App } from "./App";
import { BrowserRouter } from "react-router-dom";
import { Workbox } from "workbox-window";
import React from "react";
import ReactDOM from "react-dom";

/**
 * @description Fires callback exactly once, after the document is loaded.
 */

const whenReady = (callback: () => void): void => {
  if (document.readyState !== "loading") {
    callback();
    return;
  }

  const handleContentLoaded = (): void => {
    callback();
    document.removeEventListener("DOMContentLoaded", handleContentLoaded);
  };

  document.addEventListener("DOMContentLoaded", handleContentLoaded);
};

whenReady(() => {
  const root = document.querySelector("#root");
  const renderAll = (): void => {
    ReactDOM.render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
      root
    );
  };
  window.addEventListener("online", renderAll);
  window.addEventListener("offline", renderAll);
  renderAll();
});

if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    const workbox = new Workbox("/service-worker.js");

    workbox.addEventListener("installed", (event) => {
      if (event.isUpdate) {
        window.location.reload();
      }
    });

    workbox.register();
  });
}
