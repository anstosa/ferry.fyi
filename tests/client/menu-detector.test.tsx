// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessTokenSilently: vi.fn(() => Promise.resolve("access-token")),
  isAuthenticated: true,
  loginWithPopup: vi.fn(),
  loginWithRedirect: vi.fn(),
  user: { email: "anstosa@gmail.com" } as { email: string } | undefined,
}));
const appAuth = vi.hoisted(() => ({ loginWithAppFlow: vi.fn() }));

vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn() } }));
vi.mock("@capacitor/share", () => ({
  Share: { canShare: vi.fn(() => Promise.resolve({ value: false })) },
}));
vi.mock("~/lib/appInstall", () => ({
  getBrowserInstallPlatform: vi.fn(() => null),
  requestInstallPrompt: vi.fn(),
}));
vi.mock("~/lib/auth", () => ({
  getConfiguredAuth0RedirectUri: vi.fn(() => "http://localhost/callback"),
  loginWithAppFlow: appAuth.loginWithAppFlow,
}));
vi.mock("~/lib/device", () => ({
  isInstalledApp: vi.fn(() => true),
  useDevice: vi.fn(() => ({ isNativeMobile: false })),
}));
vi.mock("~/lib/featureFlags", () => ({
  useFeatureFlags: vi.fn(() => ({ leaderboardsEnabled: false })),
}));

import {
  CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_ATTEMPT_KEY,
  CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
  CAMERA_DETECTION_DEBUGGER_PATH,
  CAMERA_DETECTION_DEBUGGER_TOKEN_KEY,
  getCameraDetectionDebuggerAuthorizationReturnPath,
  openCameraDetectionDebugger,
} from "../../client/lib/cameraDetectionDebugger";
import { Menu } from "../../client/views/Menu";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

// render one menu environment
const renderMenu = (environment: string, email: string): string => {
  auth.user = { email };
  return renderToStaticMarkup(
    <MemoryRouter>
      <Menu
        environment={environment}
        hasTopBanner={false}
        isOpen
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />
    </MemoryRouter>
  );
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  auth.isAuthenticated = true;
  auth.user = { email: "anstosa@gmail.com" };
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("Detector menu shortcut", () => {
  // bounded authorization routes
  it("maps only supported debugger authorization returns", () => {
    expect(
      getCameraDetectionDebuggerAuthorizationReturnPath(
        "?authorizeCameraDetectionDebugger=editor"
      )
    ).toBe("/dev/camera-detection/editor");
    expect(
      getCameraDetectionDebuggerAuthorizationReturnPath(
        "?authorizeCameraDetectionDebugger=https://example.com"
      )
    ).toBeNull();
    expect(
      getCameraDetectionDebuggerAuthorizationReturnPath(
        "?authorizeCameraDetectionDebugger=toString"
      )
    ).toBeNull();
  });

  // visibility boundary
  it("shows only for the owner in development", () => {
    expect(renderMenu("development", "anstosa@gmail.com")).toContain(
      ">Detector<"
    );
    expect(renderMenu("production", "anstosa@gmail.com")).not.toContain(
      ">Detector<"
    );
    expect(renderMenu("development", "passenger@example.com")).not.toContain(
      ">Detector<"
    );
  });

  // retain deep links through interactive login
  it("returns to the complete admin URL after login", async () => {
    auth.isAuthenticated = false;
    auth.user = undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MemoryRouter
          initialEntries={[
            "/admin?placement=schedule--5--14&tab=ads#admin-ad-placement",
          ]}
        >
          <Menu
            hasTopBanner={false}
            isOpen
            onClose={vi.fn()}
            onOpen={vi.fn()}
          />
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    const login = [...container.querySelectorAll("span")]
      .find((label) => label.textContent === "Log In")
      ?.closest("div");
    await act(async () => {
      login?.click();
      await Promise.resolve();
    });

    expect(appAuth.loginWithAppFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          appState: {
            redirectPath:
              "/admin?placement=schedule--5--14&tab=ads#admin-ad-placement",
          },
        }),
      })
    );
  });

  // authorization bridge
  it("stores owner authorization before opening benchmark labels", async () => {
    const navigate = vi.fn();
    const getAccessToken = vi.fn(() => Promise.resolve("owner-token"));
    sessionStorage.setItem(
      CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_ATTEMPT_KEY,
      "true"
    );
    sessionStorage.setItem(
      CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
      "true"
    );

    await openCameraDetectionDebugger(getAccessToken, navigate);

    expect(sessionStorage.getItem(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY)).toBe(
      "owner-token"
    );
    expect(CAMERA_DETECTION_DEBUGGER_PATH).toBe(
      "/dev/camera-detection/benchmarks"
    );
    expect(
      sessionStorage.getItem(
        CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_ATTEMPT_KEY
      )
    ).toBeNull();
    expect(
      sessionStorage.getItem(
        CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY
      )
    ).toBeNull();
    expect(navigate).toHaveBeenCalledWith(CAMERA_DETECTION_DEBUGGER_PATH);
  });
});
