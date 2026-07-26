// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(() => Promise.resolve("access-token")),
  isAuthenticated: true,
  user: { email: "anstosa@gmail.com" },
}));
const api = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/components/Page", () => ({
  Page: ({ children }: { children: React.ReactNode }) =>
    React.createElement("main", undefined, children),
}));
vi.mock("~/lib/api", () => api);

import { Admin } from "../../client/views/Admin";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Admin", () => {
  it("keeps the admin tab strip horizontally scrollable without vertical overflow", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Admin));
    });

    expect(container.querySelector('[role="tablist"]')?.className).toContain(
      "overflow-y-hidden"
    );
  });

  it("lists users before loading support data for the selected row", async () => {
    api.get.mockImplementation((path: string) => {
      if (path.startsWith("/admin/users?")) {
        return Promise.resolve({
          items: [{ email: "person@example.com", subject: "auth0|person" }],
          page: 0,
          pageSize: 25,
          total: 1,
        });
      }
      if (path === "/admin/users/lookup?subject=auth0%7Cperson") {
        return Promise.resolve({
          email: "person@example.com",
          leaderboard: {
            checkins: { terminal: 1, total: 2, vessel: 1 },
            optedOut: false,
            profile: {
              automaticCheckinsEnabled: false,
              displayName: "PS",
              notificationsEnabled: true,
              optedOut: false,
              useFullName: false,
              verboseNotificationsEnabled: false,
            },
            profileExists: true,
            terminalPresenceCount: 0,
          },
          settings: {
            alertRules: [],
            alertSubscriptions: {},
            favoriteRouteIds: [],
            hasPushToken: false,
            subscribedTerminalIds: [],
            ticketCount: 0,
          },
          subject: "auth0|person",
        });
      }
      return Promise.resolve({
        automaticLeaderboardCheckinsEnabled: false,
        leaderboardsEnabled: false,
      });
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Admin));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Users")
        ?.click();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith("/admin/users?page=0", "access-token");
    expect(
      container.querySelector("#admin-user-search")?.closest("form")?.className
    ).toContain("w-full");
    expect(container.querySelector("#admin-user-search")?.className).toContain(
      "rounded-r-none"
    );
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Search"
      )?.className
    ).toContain("button-group-right");

    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("person@example.com"))
        ?.click();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith(
      "/admin/users/lookup?subject=auth0%7Cperson",
      "access-token"
    );
    expect(container.textContent).toContain("person@example.com");
    expect(container.textContent).toContain("Tickets saved: 0");
    expect(container.textContent).toContain("Push token: none");
    expect(container.textContent).not.toContain("Leaderboard moderation");
    expect(api.get).not.toHaveBeenCalledWith(
      "/admin/leaderboards/metrics",
      "access-token"
    );
  });

  it("explains a scheduled data operation and its latest run", async () => {
    api.get.mockImplementation((path: string) => {
      if (path === "/admin/operations") {
        return Promise.resolve({
          operations: [
            {
              canRun: false,
              description: "Refreshes camera line-detection results.",
              error: null,
              lastRunAt: "2026-07-25T00:30:00.000Z",
              operation: "camera-line-detection-refresh",
              result: "Completed",
              startedAt: "2026-07-25T00:29:59.000Z",
              status: "succeeded",
              trigger: "Every minute at :30 on the scheduler process.",
            },
          ],
        });
      }
      return Promise.resolve({
        automaticLeaderboardCheckinsEnabled: false,
        leaderboardsEnabled: false,
      });
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Admin));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Data operations")
        ?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Refreshes camera line-detection results."
    );
    expect(container.textContent).toContain("Normal trigger:");
    expect(container.textContent).toContain("Last run:");
    expect(container.textContent).toContain(
      "Scheduled automatically; no manual action is available."
    );
  });

  it("selects a targeted one-off notification recipient without visiting Users", async () => {
    api.get.mockImplementation((path: string) => {
      if (path === "/admin/notifications") {
        return Promise.resolve({
          inFlight: 0,
          policy: { paused: false },
          queueState: "not-queued",
          queued: 0,
          requestResult: null,
        });
      }
      if (path === "/admin/users?page=0&query=person") {
        return Promise.resolve({
          items: [{ email: "person@example.com", subject: "auth0|person" }],
          page: 0,
          pageSize: 25,
          total: 1,
        });
      }
      return Promise.resolve({
        automaticLeaderboardCheckinsEnabled: false,
        leaderboardsEnabled: false,
      });
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Admin));
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Notifications")
        ?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Pause notifications");
    expect(container.textContent).not.toContain("Policy:");
    expect(
      container.querySelector(
        '[role="switch"][aria-label="Pause notifications"]'
      )
    ).not.toBeNull();
    const audience = container.querySelector<HTMLSelectElement>(
      "#admin-notification-mode"
    );
    await act(async () => {
      if (audience) {
        audience.value = "targeted";
        audience.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const search = container.querySelector<HTMLInputElement>(
      "#notification-user-search"
    );
    await act(async () => {
      if (search) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set?.call(search, "person");
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Search")
        ?.click();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith(
      "/admin/users?page=0&query=person",
      "access-token"
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("person@example.com"))
        ?.click();
    });
    expect(container.textContent).toContain("Selected: person@example.com");
  });
});
