// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supporter = vi.hoisted(() => ({
  error: null,
  isBusy: false,
  isLoading: false,
  manage: vi.fn(),
  products: [],
  purchase: vi.fn(),
  refresh: vi.fn(),
  restore: vi.fn(),
  setBadgeVisible: vi.fn(),
  status: null,
}));
const user = vi.hoisted(
  (): { isAuthenticated: boolean; user?: { user_id: string } } => ({
    isAuthenticated: true,
    user: { user_id: "auth0|rider-a" },
  })
);

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web" },
}));
vi.mock("~/lib/supporterContext", () => ({
  useSupporter: () => supporter,
}));
vi.mock("~/lib/user", () => ({ useUser: () => [user] }));

import { SupporterCard } from "~/components/SupporterCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

// render the supporter purchase surface
const renderCard = async (): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <SupporterCard />
      </MemoryRouter>
    );
    await Promise.resolve();
  });
};

describe("SupporterCard", () => {
  beforeEach(() => {
    supporter.refresh.mockReset().mockResolvedValue(undefined);
    user.isAuthenticated = true;
    user.user = { user_id: "auth0|rider-a" };
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
  });

  // defer provider identity until the purchase surface opens
  it("loads supporter state once per authenticated account", async () => {
    await renderCard();
    expect(supporter.refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SupporterCard />
        </MemoryRouter>
      );
      await Promise.resolve();
    });
    expect(supporter.refresh).toHaveBeenCalledTimes(1);

    user.user = { user_id: "auth0|rider-b" };
    await act(async () => {
      root?.render(
        <MemoryRouter>
          <SupporterCard />
        </MemoryRouter>
      );
      await Promise.resolve();
    });
    expect(supporter.refresh).toHaveBeenCalledTimes(2);
  });

  // preserve signed-out privacy boundary
  it("does not allocate billing identity for signed-out visitors", async () => {
    user.isAuthenticated = false;
    user.user = undefined;

    await renderCard();

    expect(supporter.refresh).not.toHaveBeenCalled();
  });
});
