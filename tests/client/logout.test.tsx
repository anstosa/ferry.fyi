// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/components/Splash", () => ({
  // splash fixture
  Splash: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { CAMERA_DETECTION_DEBUGGER_TOKEN_KEY } from "../../client/lib/cameraDetectionDebugger";
import { Logout } from "../../client/views/Logout";

let root: Root | undefined;

// logout route render
const renderLogout = (): HTMLDivElement => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={["/logout"]}>
        <Routes>
          <Route element={<Logout />} path="/logout" />
          <Route element={<p>Home page</p>} path="/" />
        </Routes>
      </MemoryRouter>
    );
  });
  return container;
};

describe("Logout", () => {
  // reset logout fixture
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    auth.logout.mockReset();
    localStorage.clear();
  });

  it("clears local authentication and returns home", async () => {
    auth.logout.mockResolvedValue(undefined);
    localStorage.setItem(
      CAMERA_DETECTION_DEBUGGER_TOKEN_KEY,
      "owner-access-token"
    );
    const container = renderLogout();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(auth.logout).toHaveBeenCalledOnce();
    expect(auth.logout).toHaveBeenCalledWith({ openUrl: false });
    expect(
      localStorage.getItem(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY)
    ).toBeNull();
    expect(container.textContent).toContain("Home page");
  });

  it("keeps a retry action visible until local authentication clears", async () => {
    auth.logout
      .mockRejectedValueOnce(new Error("Local cache unavailable"))
      .mockResolvedValueOnce(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    const container = renderLogout();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Home page");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try logout again"
    );
    expect(retry).toBeDefined();

    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(auth.logout).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Home page");
    expect(consoleError).toHaveBeenCalledWith(
      "Local logout failed",
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
