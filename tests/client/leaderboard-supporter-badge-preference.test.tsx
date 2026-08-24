// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeaderboardSupporterBadgePreference } from "~/components/LeaderboardSupporterBadgePreference";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

// render one supporter badge preference
const renderPreference = async ({
  active = true,
  disabled = false,
  displayName = "AS",
  onChange = vi.fn(),
  visible = false,
}: Partial<React.ComponentProps<
  typeof LeaderboardSupporterBadgePreference
>> = {}): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LeaderboardSupporterBadgePreference
        active={active}
        disabled={disabled}
        displayName={displayName}
        onChange={onChange}
        visible={visible}
      />
    );
    await Promise.resolve();
  });
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("LeaderboardSupporterBadgePreference", () => {
  // hide supporter-only controls
  it("does not render for inactive accounts", async () => {
    await renderPreference({ active: false });

    expect(container?.textContent).toBe("");
  });

  // show the exact public badge preview
  it("previews the badge and current public visibility", async () => {
    await renderPreference({ displayName: "Ferry Fan", visible: true });

    const toggle = container?.querySelector('[role="switch"]');
    const preview = container?.querySelector(
      '[aria-label="Supporter badge preview"]'
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(preview?.textContent).toContain("Ferry Fan");
    expect(preview?.textContent).toContain("Supporter");
    expect(preview?.querySelector(".flex-1")?.className).toContain(
      "items-center"
    );
    expect(preview?.querySelector(".rounded-full")?.className).toContain(
      "items-center"
    );
    expect(container?.textContent).not.toContain("This cosmetic badge");
  });

  // save the inverse public preference
  it("toggles badge visibility", async () => {
    const onChange = vi.fn();
    await renderPreference({ onChange, visible: false });

    await act(async () => {
      container
        ?.querySelector('[role="switch"]')
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
