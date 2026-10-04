// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AdminTerminalLocation } from "shared/contracts/terminalLocations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalLocations } from "../../client/components/admin/TerminalLocations";
import { confirmationPhrase } from "../../client/lib/adminConfirmation";

const adapters = vi.hoisted(() => ({
  put: vi.fn(),
  refreshTerminalLocations: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lib/api", () => ({ put: adapters.put }));
vi.mock("~/lib/terminals", () => ({
  refreshTerminalLocations: adapters.refreshTerminalLocations,
}));
vi.mock("~/components/admin/TerminalLocationMap", () => ({
  TerminalLocationMap: ({ onChange }: { onChange: Function }) => (
    <div aria-label="Terminal location map">
      <button
        onClick={() =>
          onChange("booth", { latitude: 47.91, longitude: -122.31 })
        }
        type="button"
      >
        Map booth
      </button>
      <button
        onClick={() =>
          onChange("dock", { latitude: 47.92, longitude: -122.32 })
        }
        type="button"
      >
        Map dock
      </button>
    </div>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const initialTerminals: AdminTerminalLocation[] = [
  {
    abbreviation: "CLI",
    booth: { latitude: 47.97, longitude: -122.34 },
    defaultDock: { latitude: 47.98, longitude: -122.35 },
    dock: { latitude: 47.99, longitude: -122.36 },
    name: "Clinton",
    terminalId: "5",
    updatedAt: null,
  },
  {
    abbreviation: "MUK",
    booth: { latitude: 47.94, longitude: -122.3 },
    defaultDock: { latitude: 47.95, longitude: -122.31 },
    dock: null,
    name: "Mukilteo",
    terminalId: "14",
    updatedAt: null,
  },
];

let container: HTMLDivElement;
let root: Root;
let onSaved: ReturnType<typeof vi.fn>;
let saveRejected: ReturnType<typeof vi.fn>;

// locate one exact button label
const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent === label
  );

// update one controlled field or select
const change = (label: string, value: string): void => {
  const element = container.querySelector(`[aria-label="${label}"]`) as
    | HTMLInputElement
    | HTMLSelectElement;
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      element,
      value
    );
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      })
    );
  });
};

// mount the editor with a direct save trigger
beforeEach(() => {
  vi.resetAllMocks();
  adapters.refreshTerminalLocations.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onSaved = vi.fn();
  saveRejected = vi.fn();
  act(() => {
    root.render(
      <TerminalLocations
        onSaved={onSaved}
        renderSave={({ disabled, label, onConfirm }) => (
          <button
            disabled={disabled}
            onClick={() => {
              // contain rejected saves in the test trigger
              onConfirm().catch(saveRejected);
            }}
            type="button"
          >
            {label}
          </button>
        )}
        terminals={initialTerminals}
        token={() => Promise.resolve("access-token")}
      />
    );
  });
});

// release each editor fixture
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("terminal location editor", () => {
  // edit both points from accessible manual and map controls
  it("shows separate booth and dock controls", () => {
    expect(container.textContent).toContain("Toll booth / navigation");
    expect(container.textContent).toContain("Dock / public map");
    expect(
      (
        container.querySelector(
          '[aria-label="Toll booth point latitude"]'
        ) as HTMLInputElement
      ).value
    ).toBe("47.97");

    act(() => button("Map booth")?.click());
    expect(
      (
        container.querySelector(
          '[aria-label="Toll booth point latitude"]'
        ) as HTMLInputElement
      ).value
    ).toBe("47.91");
    expect(button("Save terminal locations")?.disabled).toBe(false);
  });

  // block incomplete or out-of-region coordinate pairs
  it("rejects invalid manual points before confirmation", () => {
    change("Toll booth point latitude", "51");

    expect(container.textContent).toContain(
      "Booth point must be within latitude 45–50 and longitude -125–-119."
    );
    expect(button("Save terminal locations")?.disabled).toBe(true);
    expect(adapters.put).not.toHaveBeenCalled();
  });

  // clear nullable points and submit one confirmed atomic payload
  it("saves cleared point pairs with the exact confirmation", async () => {
    const saved = {
      ...initialTerminals[0],
      booth: null,
      dock: null,
      updatedAt: "2026-10-03T12:00:00.000Z",
    };
    adapters.put.mockResolvedValue(saved);
    act(() => button("Clear booth point")?.click());
    act(() => button("Clear dock point")?.click());
    await act(async () => {
      button("Save terminal locations")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const target = "terminal:5";
    expect(adapters.put).toHaveBeenCalledWith(
      "/admin/terminal-locations/5",
      {
        action: "save-terminal-locations",
        booth: null,
        confirmation: confirmationPhrase("save-terminal-locations", target),
        dock: null,
        target,
      },
      "access-token"
    );
    expect(adapters.refreshTerminalLocations).toHaveBeenCalledWith("5");
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  // preserve an edited draft after a failed save
  it("keeps the draft when saving fails", async () => {
    adapters.put.mockRejectedValue(new Error("save failed"));
    change("Toll booth point latitude", "47.8");
    await act(async () => {
      button("Save terminal locations")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      (
        container.querySelector(
          '[aria-label="Toll booth point latitude"]'
        ) as HTMLInputElement
      ).value
    ).toBe("47.8");
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveRejected).toHaveBeenCalledOnce();
  });

  // keep a committed save successful when only public refresh fails
  it("separates a public cache refresh warning from the saved result", async () => {
    const saved = {
      ...initialTerminals[0],
      booth: { latitude: 47.8, longitude: -122.34 },
      updatedAt: "2026-10-03T12:00:00.000Z",
    };
    adapters.put.mockResolvedValue(saved);
    adapters.refreshTerminalLocations.mockRejectedValue(
      new Error("refresh failed")
    );
    change("Toll booth point latitude", "47.8");
    await act(async () => {
      button("Save terminal locations")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(
      (
        container.querySelector(
          '[aria-label="Toll booth point latitude"]'
        ) as HTMLInputElement
      ).value
    ).toBe("47.8");
    expect(container.textContent).toContain(
      "Terminal locations were saved, but the public terminal cache could not be refreshed."
    );
    expect(saveRejected).not.toHaveBeenCalled();
  });

  // ignore a completion that belongs to a previously selected terminal
  it("does not replace a newer terminal draft with a stale save", async () => {
    let resolveSave!: (value: AdminTerminalLocation) => void;
    adapters.put.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );
    change("Toll booth point latitude", "47.8");
    await act(async () => {
      button("Save terminal locations")?.click();
      await Promise.resolve();
    });
    const terminalSelect = container.querySelector(
      "#terminal-location"
    ) as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )?.set?.call(terminalSelect, "14");
      terminalSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      resolveSave({ ...initialTerminals[0], booth: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      (
        container.querySelector(
          '[aria-label="Toll booth point latitude"]'
        ) as HTMLInputElement
      ).value
    ).toBe("47.94");
  });
});
