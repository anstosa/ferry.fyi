// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("~/components/Splash", () => ({ Splash: () => <p>Logging out</p> }));

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
  });

  it("clears local authentication and returns home", async () => {
    auth.logout.mockResolvedValue(undefined);
    const container = renderLogout();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(auth.logout).toHaveBeenCalledOnce();
    expect(auth.logout).toHaveBeenCalledWith({ openUrl: false });
    expect(container.textContent).toContain("Home page");
  });
});
