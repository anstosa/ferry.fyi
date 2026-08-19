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
const terminals = vi.hoisted(() => ({
  getTerminals: vi.fn(() =>
    Promise.resolve([
      {
        id: "5",
        mates: [{ id: "14", name: "Mukilteo" }],
        name: "Clinton",
      },
      {
        id: "14",
        mates: [{ id: "5", name: "Clinton" }],
        name: "Mukilteo",
      },
    ])
  ),
}));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/components/Page", () => ({
  Page: ({ children }: { children: React.ReactNode }) =>
    React.createElement("main", undefined, children),
}));
vi.mock("~/lib/api", () => api);
vi.mock("~/lib/terminals", () => terminals);

import { Admin } from "../../client/views/Admin";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
});

describe("Admin", () => {
  it("offers only truthful canned User-Agent profiles for ticket lookup", async () => {
    window.history.replaceState({}, "", "/admin?tab=tickets");
    api.get.mockImplementation((path: string) => {
      if (path === "/admin/tickets") {
        return Promise.resolve({
          cacheTtlSeconds: 1_800,
          selectedUserAgentProfile: "identified-contact",
          userAgentProfiles: [
            {
              id: "identified-contact",
              label: "Ferry FYI with contact",
              userAgent: "FerryFYI/1.0 (+https://ferry.fyi; dev@ferry.fyi)",
            },
            {
              id: "identified-product",
              label: "Ferry FYI with product URL",
              userAgent: "FerryFYI/1.0 (+https://ferry.fyi)",
            },
            {
              id: "identified-minimal",
              label: "Ferry FYI minimal",
              userAgent: "FerryFYI/1.0",
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // render one complete feature policy surface
    await act(async () => {
      root?.render(React.createElement(Admin));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('#admin-tab-tickets[aria-selected="true"]')
    ).not.toBeNull();
    const select = container.querySelector(
      "#ticket-lookup-user-agent"
    ) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    expect(select.value).toBe("identified-contact");
    expect(container.textContent).toContain(
      "FerryFYI/1.0 (+https://ferry.fyi; dev@ferry.fyi)"
    );
    expect(container.textContent).not.toContain("Mozilla/5.0");
  });

  it("opens a deep-linked directional ad placement", async () => {
    window.history.replaceState(
      {},
      "",
      "/admin?placement=schedule--5--14&tab=ads#admin-ad-placement"
    );
    api.get.mockImplementation((path: string) => {
      if (path === "/admin/ads") {
        return Promise.resolve({ adsEnabled: true, placements: [] });
      }
      if (path === "/admin/ads/campaigns") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Admin));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('#admin-tab-ads[aria-selected="true"]')
    ).not.toBeNull();
    expect(
      (container.querySelector("#admin-ad-slot") as HTMLSelectElement).value
    ).toBe("schedule");
    expect(
      (container.querySelector("#admin-ad-direction") as HTMLSelectElement)
        .value
    ).toBe("5--14");
    expect(document.activeElement?.id).toBe("admin-ad-slot");
  });

  it("shows an accessible feature-flags skeleton until the initial request completes", async () => {
    let resolveFeatures:
      | ((value: {
          automaticLeaderboardCheckinsEnabled: boolean;
          leaderboardsEnabled: boolean;
        }) => void)
      | undefined;
    let resolveLeaderboardFeature:
      | ((value: {
          enabled: boolean;
          killSwitch: boolean;
          name: string;
          subjects: string[];
        }) => void)
      | undefined;
    let resolveAutomaticFeature:
      | ((value: {
          enabled: boolean;
          killSwitch: boolean;
          name: string;
          subjects: string[];
        }) => void)
      | undefined;
    api.get.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path === "/admin/features") {
            resolveFeatures = resolve;
          }
          if (path === "/admin/features/leaderboards") {
            resolveLeaderboardFeature = resolve;
          }
          if (path === "/admin/features/automaticLeaderboardCheckins") {
            resolveAutomaticFeature = resolve;
          }
        })
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Admin));
    });

    expect(
      container.querySelector(
        '[role="status"][aria-label="Loading feature flags"]'
      )
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Loading…");

    await act(async () => {
      resolveFeatures?.({
        automaticLeaderboardCheckinsEnabled: false,
        leaderboardsEnabled: false,
      });
      resolveLeaderboardFeature?.({
        enabled: false,
        killSwitch: false,
        name: "leaderboards",
        subjects: [],
      });
      resolveAutomaticFeature?.({
        enabled: false,
        killSwitch: false,
        name: "automaticLeaderboardCheckins",
        subjects: [],
      });
      await Promise.resolve();
    });

    expect(
      container.querySelector(
        '[role="status"][aria-label="Loading feature flags"]'
      )
    ).toBeNull();
    expect(container.textContent).toContain("Emergency kill switch:");
    expect(container.textContent).toContain("Automatic leaderboard check-ins");
  });

  // verify independent automatic subject policy writes
  it("saves the automatic check-in allowlist through its exact endpoint", async () => {
    api.get.mockImplementation(
      // return each independently managed feature fixture
      (path: string) => {
        // return the legacy projection
        if (path === "/admin/features") {
          return Promise.resolve({
            automaticLeaderboardCheckinsEnabled: false,
            leaderboardsEnabled: true,
          });
        }
        // return the parent subject policy
        if (path === "/admin/features/leaderboards") {
          return Promise.resolve({
            enabled: true,
            killSwitch: false,
            name: "leaderboards",
            subjects: ["auth0|parent"],
          });
        }
        // return the automatic subject policy
        if (path === "/admin/features/automaticLeaderboardCheckins") {
          return Promise.resolve({
            enabled: false,
            killSwitch: false,
            name: "automaticLeaderboardCheckins",
            subjects: ["auth0|automatic-old"],
          });
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }
    );
    api.put.mockResolvedValue({
      enabled: true,
      killSwitch: false,
      name: "automaticLeaderboardCheckins",
      subjects: ["auth0|automatic-a", "auth0|automatic-b"],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(Admin));
      await Promise.resolve();
      await Promise.resolve();
    });

    const toggle = container.querySelector(
      '[aria-label="Enable automatic leaderboard check-ins"]'
    ) as HTMLButtonElement;
    const allowlist = container.querySelector(
      "#automaticLeaderboardCheckins-allowlist"
    ) as HTMLTextAreaElement;
    const save = [...container.querySelectorAll("button")].find(
      // find one exact automatic save action
      (button) =>
        button.textContent === "Save automatic leaderboard check-ins access"
    );

    // toggle one automatic feature decision
    await act(async () => {
      toggle.click();
    });
    // stage one exact automatic allowlist
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set?.call(allowlist, "auth0|automatic-a\nauth0|automatic-b");
      allowlist.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // save one automatic feature policy
    await act(async () => {
      save?.click();
      await Promise.resolve();
    });

    expect(api.put).toHaveBeenCalledWith(
      "/admin/features/automaticLeaderboardCheckins",
      {
        enabled: true,
        subjects: ["auth0|automatic-a", "auth0|automatic-b"],
      },
      "access-token"
    );
    expect(api.put).not.toHaveBeenCalledWith(
      "/admin/features/leaderboards",
      expect.anything(),
      expect.anything()
    );
  });

  it("surfaces the first user-directory load failure in the section", async () => {
    api.get.mockImplementation((path: string) => {
      if (path.startsWith("/admin/users?")) {
        return Promise.reject(new Error("Unavailable"));
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
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Could not load user directory.");
    expect(container.querySelector("#admin-user-search")).toBeNull();
  });

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

  it("edits route ad placements separately for each direction", async () => {
    api.get.mockImplementation((path: string) => {
      if (path === "/admin/ads") {
        return Promise.resolve({
          adsEnabled: true,
          placements: [
            {
              advertiserName: "Island Coffee",
              arrivalTerminalId: "14",
              body: "",
              departureTerminalId: "5",
              enabled: true,
              headline: "Clinton offer",
              key: "schedule--5--14",
              slot: "schedule",
              targetUrl: "https://example.com/clinton",
            },
            {
              advertiserName: "Mainland Coffee",
              arrivalTerminalId: "5",
              body: "",
              departureTerminalId: "14",
              enabled: true,
              headline: "Mukilteo offer",
              key: "schedule--14--5",
              slot: "schedule",
              targetUrl: "https://example.com/mukilteo",
            },
          ],
        });
      }
      if (path === "/admin/ads/campaigns") {
        return Promise.resolve([]);
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
        .find((button) => button.textContent === "Advertising")
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith("/admin/ads", "access-token");
    expect(
      container.querySelector(
        '[role="switch"][aria-label="Show advertisements globally"]'
      )
    ).not.toBeNull();

    const slot = container.querySelector<HTMLSelectElement>("#admin-ad-slot");
    await act(async () => {
      if (slot) {
        slot.value = "schedule";
        slot.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const direction = container.querySelector<HTMLSelectElement>(
      "#admin-ad-direction"
    );
    expect(direction?.textContent).toContain("Clinton → Mukilteo");
    expect(direction?.textContent).toContain("Mukilteo → Clinton");
    expect(
      container.querySelector<HTMLInputElement>("#admin-ad-headline")?.value
    ).toBe("Clinton offer");

    await act(async () => {
      if (direction) {
        direction.value = "14--5";
        direction.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(
      container.querySelector<HTMLInputElement>("#admin-ad-headline")?.value
    ).toBe("Mukilteo offer");
  });
});
