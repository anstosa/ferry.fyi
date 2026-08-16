// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(() => Promise.resolve("fresh-owner-token")),
  isAuthenticated: true,
  isLoading: false,
  loginWithRedirect: vi.fn(() => Promise.resolve()),
}));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));

import { CameraDetectionDebuggerAuthorization } from "../../client/components/CameraDetectionDebuggerAuthorization";
import {
  CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
  CAMERA_DETECTION_DEBUGGER_TOKEN_KEY,
} from "../../client/lib/cameraDetectionDebugger";

describe("camera detection debugger authorization", () => {
  let root: Root | undefined;

  // render one authorization recovery request
  const renderAuthorization = async (
    navigate = vi.fn()
  ): Promise<ReturnType<typeof vi.fn>> => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const renderRoot = root;

    await act(async () => {
      renderRoot.render(
        <CameraDetectionDebuggerAuthorization
          environment="development"
          navigate={navigate}
          search="?authorizeCameraDetectionDebugger=benchmarks"
        />
      );
      // flush authorization effect
      await Promise.resolve();
    });
    return navigate;
  };

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    auth.getAccessTokenSilently.mockReset();
    auth.getAccessTokenSilently.mockResolvedValue("fresh-owner-token");
    auth.isAuthenticated = true;
    auth.isLoading = false;
    auth.loginWithRedirect.mockReset();
    auth.loginWithRedirect.mockResolvedValue(undefined);
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  // silent token refresh contract
  it("refreshes the owner token and returns to benchmark labels", async () => {
    const navigate = await renderAuthorization();

    expect(auth.getAccessTokenSilently).toHaveBeenCalledWith({
      cacheMode: "off",
    });
    expect(localStorage.getItem(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY)).toBe(
      "fresh-owner-token"
    );
    expect(
      sessionStorage.getItem(
        CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY
      )
    ).toBe("true");
    expect(navigate).toHaveBeenCalledWith("/dev/camera-detection/benchmarks");
  });

  // interactive login fallback contract
  it("starts login when the browser session is no longer authenticated", async () => {
    auth.isAuthenticated = false;
    await renderAuthorization();

    expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
    expect(auth.loginWithRedirect).toHaveBeenCalledWith({
      appState: {
        redirectPath: "/?authorizeCameraDetectionDebugger=benchmarks",
      },
    });
  });

  // expired session fallback contract
  it("starts login when silent token refresh fails", async () => {
    auth.getAccessTokenSilently.mockRejectedValueOnce({
      error: "login_required",
    });

    await renderAuthorization();

    expect(auth.loginWithRedirect).toHaveBeenCalledWith({
      appState: {
        redirectPath: "/?authorizeCameraDetectionDebugger=benchmarks",
      },
    });
  });

  // transient refresh failure contract
  it("does not force login after a transient silent refresh failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    auth.getAccessTokenSilently.mockRejectedValueOnce(
      new Error("Auth0 request timed out")
    );

    const navigate = await renderAuthorization();

    expect(auth.loginWithRedirect).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Camera detector silent authorization failed",
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
