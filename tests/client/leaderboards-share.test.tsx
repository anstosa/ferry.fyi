// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  share: vi.fn(() => Promise.resolve()),
  trackUsefulEvent: vi.fn(),
}));

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: vi.fn(),
    isAuthenticated: false,
  }),
}));
vi.mock("@capacitor/share", () => ({ Share: { share: mocks.share } }));
vi.mock("~/components/LeaderboardAutomaticEnrollment", () => ({
  LeaderboardAutomaticCleanupRecovery: () => null,
  LeaderboardAutomaticEnrollment: () => null,
}));
vi.mock("~/components/LeaderboardManualCheckIn", () => ({
  LeaderboardManualCheckIn: () => null,
}));
vi.mock("~/components/LeaderboardSupporterBadgePreference", () => ({
  LeaderboardIdentity: ({ label }: { label: string }) => <span>{label}</span>,
  LeaderboardSupporterBadgePreference: () => null,
}));
vi.mock("~/components/Page", () => ({
  Page: ({
    children,
    headerAction,
  }: React.PropsWithChildren<{ headerAction?: React.ReactNode }>) => (
    <main>
      {headerAction}
      {children}
    </main>
  ),
}));
vi.mock("~/components/SeoHelmet", () => ({ SeoHelmet: () => null }));
vi.mock("~/components/Skeleton", () => ({
  Skeleton: () => null,
  SkeletonGroup: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("~/components/SupporterUpgradeNudge", () => ({
  SupporterUpgradeNudge: () => null,
}));
vi.mock("~/lib/analytics", () => ({
  trackUsefulEvent: mocks.trackUsefulEvent,
}));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: () => ({ leaderboardsEnabled: true }),
}));
vi.mock("~/lib/leaderboards", () => ({
  getFirstNonEmptyLeaderboard: () => Promise.resolve(null),
  getLeaderboardPreferences: vi.fn(),
  getTerminalLeaderboard: vi.fn(),
  getVesselLeaderboard: vi.fn(),
  leaderboardPeriodOrder: ["week", "month", "all"],
  updateLeaderboardPreferences: vi.fn(),
}));
vi.mock("~/lib/supporterContext", () => ({ useSupporter: () => ({}) }));
vi.mock("~/lib/terminals", () => ({
  useTerminals: () => ({
    terminals: [{ id: "5", name: "Private terminal sentinel" }],
  }),
}));
vi.mock("~/lib/user", () => ({ useUser: () => [{}, {}] }));
vi.mock("~/lib/vessels", () => ({
  getVessel: () => Promise.resolve({ name: "Private vessel sentinel" }),
  useLiveVessels: () => [],
}));
vi.mock("../../client/views/PublicSsrPages", () => ({
  SnapshotSeoHelmet: () => null,
}));

import { Leaderboards } from "../../client/views/Leaderboards";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => {
  mocks.share.mockResolvedValue(undefined);
  window.history.replaceState(
    null,
    "",
    "/leaderboards/terminals/5?period=private#sentinel"
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// render one public leaderboard route
const renderLeaderboard = async (path: string): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <Leaderboards />
      </MemoryRouter>
    );
    await Promise.resolve();
  });
  return container;
};

// click one leaderboard share action
const clickShare = async (container: HTMLElement): Promise<void> => {
  const button = container.querySelector<HTMLButtonElement>(
    '[aria-label="Share leaderboard"]'
  );
  // required fixture action
  if (!button) {
    throw new Error("Leaderboard share action did not render");
  }
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
};

describe("public leaderboard sharing", () => {
  // both entity routes use one coarse surface
  it.each(["/terminals/5", "/vessels/kaleetan"])(
    "qualifies a resolved share on %s",
    async (path) => {
      const container = await renderLeaderboard(path);

      await clickShare(container);

      expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
      expect(mocks.trackUsefulEvent).toHaveBeenCalledWith("share_completed", {
        method: "share_sheet",
        surface: "leaderboard",
      });
      expect(JSON.stringify(mocks.trackUsefulEvent.mock.calls)).not.toContain(
        "Private"
      );
    }
  );

  // failed attempts stay silent
  it("stays silent on cancellation or failure and qualifies a later success", async () => {
    mocks.share
      .mockRejectedValueOnce(new DOMException("canceled", "AbortError"))
      .mockRejectedValueOnce(new Error("native failure"))
      .mockResolvedValueOnce(undefined);
    const container = await renderLeaderboard("/terminals/5");

    await clickShare(container);
    await clickShare(container);
    expect(mocks.trackUsefulEvent).not.toHaveBeenCalled();

    await clickShare(container);
    expect(mocks.trackUsefulEvent).toHaveBeenCalledOnce();
  });
});
