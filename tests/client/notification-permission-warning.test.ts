// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  initialize: vi.fn(),
  permission: "default" as NotificationPermission | null,
  request: vi.fn(),
}));

vi.mock("~/lib/push", () => ({
  getNotificationPermission: () => push.permission,
  requestNotificationPermission: push.request,
  requestPushInitialization: push.initialize,
}));
vi.mock("~/static/images/icons/solid/bell-slash.svg", () => ({
  default: () => null,
}));

import { NotificationPermissionWarning } from "../../client/components/NotificationPermissionWarning";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("NotificationPermissionWarning", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    push.permission = "default";
    push.request.mockReset().mockImplementation(async () => {
      push.permission = "granted";
      return true;
    });
    push.initialize.mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  const renderWarning = async (): Promise<void> => {
    await act(async () => {
      root?.render(
        React.createElement(NotificationPermissionWarning, { hasAlerts: true })
      );
    });
  };

  it("requests permission directly from the Allow notifications button", async () => {
    await renderWarning();
    const button = container.querySelector("button");

    expect(button?.textContent).toBe("Allow notifications");
    await act(async () => button?.click());

    expect(push.request).toHaveBeenCalledOnce();
    expect(push.initialize).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("");
  });

  it("does not render a retry button that browsers cannot honor after denial", async () => {
    push.permission = "denied";
    await renderWarning();

    expect(container.textContent).toContain("Notifications are blocked");
    expect(container.textContent).toContain("app or browser settings");
    expect(container.querySelector("button")).toBeNull();
    expect(push.request).not.toHaveBeenCalled();
  });
});
