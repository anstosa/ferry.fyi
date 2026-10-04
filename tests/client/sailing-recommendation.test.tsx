// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SailingRecommendationResponse } from "shared/contracts/sailingRecommendations";
import type { Schedule, Slot } from "shared/contracts/schedules";
import { unavailableRecommendation } from "shared/lib/sailingRecommendationResponse";
import {
  getRecommendationServiceDate,
  getSailingRecommendationRevision,
} from "shared/lib/sailingRecommendationRevision";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSailingRecommendation } from "../../client/lib/sailingRecommendations";
import { SailingRecommendationCard } from "../../client/views/Schedule/SailingRecommendationCard";
import { createTravelUncertainty } from "../../server/lib/sailingChance";
import {
  buildRecommendationBands,
  buildSailingAssessments,
} from "../../server/lib/sailingRecommendations";

const adapters = vi.hoisted(() => ({ post: vi.fn(), location: vi.fn() }));
vi.mock("../../client/lib/api", () => ({
  post: adapters.post,
  // retain the real error boundary shape without loading native networking
  ApiError: class extends Error {
    status: number;
    // construct a sanitized test status
    constructor(status: number) {
      super("api error");
      this.status = status;
    }
  },
}));
vi.mock("../../client/lib/geo", () => ({
  requestForegroundLocation: adapters.location,
}));
vi.mock("../../client/components/AddressAutocomplete", async () => {
  // load react after the mock factory is hoisted
  const react = await import("react");
  return {
    AddressAutocomplete: ({
      className,
      disabled,
      onChange,
      value,
    }: {
      className?: string;
      disabled?: boolean;
      onChange: (value: string, placeId?: string) => void;
      value: string;
    }) => {
      // render the controlled field contract without provider requests
      return react.createElement("input", {
        "aria-label": "Starting address",
        autoComplete: "off",
        className,
        disabled,
        maxLength: 200,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          // pass typed text through the component boundary
          onChange(
            event.target.value,
            event.target.value === "Selected Google address"
              ? "test-google-place-id"
              : undefined
          );
        },
        placeholder: "Starting address",
        value,
      });
    },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = 1_800_000_000;
let root: Root;
let container: HTMLDivElement;
let schedule: Schedule;

// assemble a deterministic public schedule without private history
const makeSchedule = (): Schedule => ({
  date: getRecommendationServiceDate(NOW),
  key: "14-5-test",
  terminalId: "14",
  mateId: "5",
  validRange: null,
  slots: [19, 40, 80].map((minutes) => {
    // expose a point-late neighbor and two eligible sailings
    return {
      allowsPassengers: true,
      allowsVehicles: true,
      estimate: { driveUpCapacity: 10, reservableCapacity: null },
      hasPassed: false,
      mateId: "5",
      time: NOW + minutes * 60,
      vessel: {
        id: "1",
        name: "Test vessel",
        vehicleCapacity: 100,
        tallVehicleCapacity: 0,
      },
      wuid: "test",
    } as Slot;
  }),
});

// return the production selector's normalized buffer domain
const makeResponse = (
  mode: SailingRecommendationResponse["mode"] = "drive",
  asOf = NOW
): SailingRecommendationResponse => {
  const candidateInput = {
    arrivalAt: asOf + 1200,
    asOf: asOf,
    mode,
    schedule,
    observations: schedule.slots.map((slot) => {
      // keep direct inventory separate from the eventual forecast
      return {
        departureTime: slot.time,
        driveUpDisplayed: true,
        driveUpSpaces: 30,
        isCancelled: false,
        maxSpaceCount: 100,
        receivedAt: asOf,
        reportingStateAtReceipt: "active" as const,
        sourceKind: "wsf-direct" as const,
        usableForFillLabel: true,
        vesselId: "1",
      };
    }),
  };
  const bands = buildRecommendationBands(candidateInput);
  const travelUncertainty = createTravelUncertainty({
    durationSeconds: 1200,
    mode,
    routeRequestedAt: asOf,
    staticDurationSeconds: 1100,
    trafficAware: mode === "drive",
  });
  return {
    sailingAssessments: buildSailingAssessments({
      ...candidateInput,
      bands,
      travelUncertainty,
    }),
    staticDurationSeconds: 1100,
    trafficDelaySeconds: mode === "drive" ? 100 : null,
    trafficLevel: mode === "drive" ? "light" : null,
    travelUncertainty,
    arrivalAt: asOf + 1200,
    attribution: "Google Maps",
    bufferOutcomeBands: bands,
    capacityWatermark: null,
    durationSeconds: 1200,
    mode,
    outcome: bands[0].outcome,
    partialMatch: false,
    recommendationAsOf: asOf,
    revision: getSailingRecommendationRevision(schedule),
    routeRequestedAt: asOf,
    source: "google-routes",
    trafficAware: mode === "drive",
    validUntil: asOf + 120,
    warnings:
      mode === "walk" || mode === "bicycle"
        ? ["Use caution on walking and cycling routes."]
        : [],
  };
};

// dispatch controlled inputs through the browser's native value setter
const input = async (label: string, value: string): Promise<void> => {
  const element = container.querySelector(
    `[aria-label="${label}"]`
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

// run an explicit origin action rather than triggering mount side effects
const click = async (label: string): Promise<void> => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent === label
  );
  await act(async () => {
    button?.click();
  });
};

// activate an accessible per-sailing chance breakdown
const expandChance = async (label: string): Promise<void> => {
  const button = container.querySelector(
    `button[aria-label^="${label}:"]`
  ) as HTMLButtonElement;
  expect(button).not.toBeNull();
  await act(async () => {
    button.click();
  });
};

// mount with isolated clock, preferences and deterministic adapters
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  window.localStorage.clear();
  vi.resetAllMocks();
  schedule = makeSchedule();
  adapters.location.mockResolvedValue({ latitude: 47.9, longitude: -122.3 });
  adapters.post.mockImplementation(async (_path, request) =>
    makeResponse(request.mode)
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SailingRecommendationCard schedule={schedule} />);
  });
});
// discard origins, timers and rendered fixtures between cases
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("leave-now sailing card", () => {
  // reuse app fields and action styles without changing accessible control names
  it("uses the shared app controls for method, buffer and origin", () => {
    const controls = Array.from(container.querySelectorAll("input"));
    expect(controls).toHaveLength(2);
    // apply the existing field appearance to every editable trip value
    for (const control of controls) {
      expect(control.classList.contains("field")).toBe(true);
      expect(control.classList.contains("rounded-xl")).toBe(true);
    }
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Drive",
      "Walk",
      "Cycle",
      "Transit",
      "Use my location",
      "Estimate trip",
    ]);
    expect(buttons.slice(0, 4).map((button) => button.ariaPressed)).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(
      buttons.slice(0, 4).every((button) => button.querySelector("svg"))
    ).toBe(true);
    expect(buttons[4].classList.contains("button-primary")).toBe(true);
    expect(buttons[4].classList.contains("hover:bg-blue-darkest")).toBe(true);
    expect(buttons[5].classList.contains("button-secondary")).toBe(true);
    expect(
      buttons.slice(0, 5).every((button) => button.type === "button")
    ).toBe(true);
    expect(buttons[5].type).toBe("submit");
    expect(buttons[4].disabled).toBe(false);
    expect(buttons[5].disabled).toBe(true);
    expect(container.querySelector("legend")?.textContent).toBe(
      "Travel method"
    );
    expect(
      (
        container.querySelector(
          '[aria-label="Starting address"]'
        ) as HTMLInputElement
      ).placeholder
    ).toBe("Starting address");
    expect(container.textContent).not.toContain(
      "Address or place in Washington"
    );
    expect(container.textContent).not.toContain("Starting address");
    expect(container.textContent).toContain(
      "Lines outside the toll booth are not included. Estimates do not guarantee boarding."
    );
    expect(container.textContent).not.toContain(
      "As you type, address suggestions are requested from Google. Your origin is sent to Ferry FYI and Google for travel estimates. Ferry FYI does not retain it."
    );
    expect(adapters.location).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
  });

  // do not acquire origin or start paid work on initial render
  it("starts with five minutes and waits for an explicit location tap", async () => {
    expect(adapters.location).not.toHaveBeenCalled();
    expect(adapters.post).not.toHaveBeenCalled();
    expect(
      (
        container.querySelector(
          '[aria-label="Safety buffer (minutes)"]'
        ) as HTMLInputElement
      ).value
    ).toBe("5");
    await click("Use my location");
    expect(adapters.location).toHaveBeenCalledOnce();
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')?.textContent
    ).toContain("Estimated");
    expect(container.textContent).toContain("Google Maps");
    expect(container.textContent).toContain("Earlier");
    expect(container.textContent).toContain("Later");
    expect(container.textContent).not.toContain("Tight timing");
    await expandChance("Estimated");
    expect(container.textContent).toContain(
      "Estimated drive-up spaces at arrival20"
    );
    expect(container.textContent).toContain("Arrival + buffer");
    expect(container.textContent).not.toContain(
      "assumed triangular distributions"
    );
    expect(container.textContent).not.toMatch(/provisional/i);
  });
  // explain denial without sending an empty or stale fix
  it("offers manual entry when location is denied", async () => {
    adapters.location.mockResolvedValue(null);
    await click("Use my location");
    expect(container.textContent).toContain(
      "Location is unavailable. Enter an address instead."
    );
    expect(adapters.post).not.toHaveBeenCalled();
    await input("Starting address", "Synthetic test origin");
    await click("Estimate trip");
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(
      (
        container.querySelector(
          '[aria-label="Starting address"]'
        ) as HTMLInputElement
      ).value
    ).toBe("");
    expect(window.localStorage.length).toBe(0);
    expect(window.location.href).not.toContain("Synthetic");
  });
  // start selected places immediately while keeping raw edits user-submitted
  it("estimates selected places immediately and submits manual edits explicitly", async () => {
    await input("Starting address", "Selected Google address");
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(adapters.post.mock.calls[0]?.[1].origin).toEqual({
      kind: "place",
      placeId: "test-google-place-id",
    });
    await input("Starting address", "Edited address");
    expect(adapters.post).toHaveBeenCalledOnce();
    await click("Estimate trip");
    expect(adapters.post.mock.calls[1]?.[1].origin).toEqual({
      address: "Edited address",
      kind: "address",
    });
  });
  // reconcile each explicit origin with fresh capacity without a page reload
  it("refreshes repeated location and selected-address estimates against the cache", async () => {
    const browserSchedule = schedule;
    const refresh = vi.fn(async () => schedule);
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={browserSchedule}
          onRefreshSchedule={refresh}
        />
      );
    });
    expect(refresh).not.toHaveBeenCalled();
    // advance inventory between successive explicit origin choices
    for (const action of ["location", "address", "address"]) {
      schedule = {
        ...schedule,
        slots: schedule.slots.map((slot) => ({
          ...slot,
          vessel: { ...slot.vessel, name: `${slot.vessel.name} updated` },
        })),
      };
      // select a place without a second form submission
      if (action === "location") {
        await click("Use my location");
      } else {
        await input("Starting address", "Selected Google address");
      }
      expect(
        container.querySelector('[aria-label="Sailing estimates"]')?.textContent
      ).toContain("Estimated");
      expect(container.textContent).not.toContain("This estimate expired");
    }
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(adapters.post).toHaveBeenCalledTimes(3);
    expect(adapters.location).toHaveBeenCalledOnce();
    expect(adapters.post.mock.calls.map((call) => call[1].origin.kind)).toEqual(
      ["coordinates", "place", "place"]
    );
    await input("Safety buffer (minutes)", "10");
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(adapters.post).toHaveBeenCalledTimes(3);
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={schedule}
          onRefreshSchedule={refresh}
        />
      );
    });
    expect(container.textContent).not.toContain("This estimate expired");
  });

  // permit one free reconciliation if inventory changes during directions
  it("resynchronizes a mid-request revision without repeating paid directions", async () => {
    const browserSchedule = schedule;
    const resultSchedule = {
      ...schedule,
      slots: schedule.slots.map((slot) => ({
        ...slot,
        vessel: { ...slot.vessel, name: "Latest vessel" },
      })),
    };
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(schedule)
      .mockResolvedValueOnce(resultSchedule);
    adapters.post.mockImplementation(async () => {
      schedule = resultSchedule;
      return makeResponse();
    });
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={browserSchedule}
          onRefreshSchedule={refresh}
        />
      );
    });
    await click("Use my location");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      adapters.post.mock.invocationCallOrder[0]
    );
    expect(refresh.mock.invocationCallOrder[1]).toBeGreaterThan(
      adapters.post.mock.invocationCallOrder[0]
    );
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')?.textContent
    ).toContain("Estimated");
    expect(container.textContent).not.toContain("This estimate expired");
  });

  // retain genuine revision guards after the bounded cache retry
  it("does not accept a result that still disagrees with the refreshed schedule", async () => {
    const refresh = vi.fn(async () => schedule);
    const result = makeResponse();
    result.revision = "different-material-snapshot";
    adapters.post.mockResolvedValue(result);
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={schedule}
          onRefreshSchedule={refresh}
        />
      );
    });
    await click("Use my location");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("This estimate expired");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
  });

  // a third displayed revision must not become an implicitly trusted baseline
  it("rejects a displayed schedule change during a matching provider request", async () => {
    const refreshed = schedule;
    const result = makeResponse();
    let resolve!: (value: SailingRecommendationResponse) => void;
    adapters.post.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const refresh = vi.fn(async () => refreshed);
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={schedule}
          onRefreshSchedule={refresh}
        />
      );
    });
    await click("Use my location");
    const changed = {
      ...schedule,
      slots: schedule.slots.map((slot) => ({
        ...slot,
        vessel: { ...slot.vessel, name: "Changed during directions" },
      })),
    };
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={changed}
          onRefreshSchedule={refresh}
        />
      );
    });
    await act(async () => {
      resolve(result);
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("This estimate expired");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
  });

  // cancel obsolete cache completions before paid work starts
  it("does not request directions after changing mode during cache refresh", async () => {
    let resolve!: (value: Schedule) => void;
    const refresh = vi.fn(
      () =>
        new Promise<Schedule>((done) => {
          resolve = done;
        })
    );
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={schedule}
          onRefreshSchedule={refresh}
        />
      );
    });
    await click("Use my location");
    await click("Walk");
    await act(async () => {
      resolve(schedule);
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(adapters.post).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Estimating your trip");
  });

  // stop before directions if the authoritative cache cannot be read
  it("does not spend a provider request when the schedule refresh fails", async () => {
    const refresh = vi.fn(async () => null);
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          schedule={schedule}
          onRefreshSchedule={refresh}
        />
      );
    });
    await click("Use my location");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Could not refresh the ferry schedule. Try again."
    );
  });

  // keep each result's expiry timer tied to its own explicit request
  it("replaces an expired location result with a fresh selected address", async () => {
    adapters.post.mockImplementation(async (_path, request) =>
      makeResponse(request.mode, Math.floor(Date.now() / 1000))
    );
    await click("Use my location");
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(container.textContent).toContain("This estimate expired");
    await input("Starting address", "Selected Google address");
    expect(adapters.post).toHaveBeenCalledTimes(2);
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')?.textContent
    ).toContain("Estimated");
    expect(container.textContent).not.toContain("This estimate expired");
    await act(async () => {
      vi.advanceTimersByTime(119_000);
    });
    expect(container.textContent).not.toContain("This estimate expired");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain("This estimate expired");
    expect(adapters.post).toHaveBeenCalledTimes(2);
  });

  // a previous timer must not shorten a new origin's validity window
  it("keeps a second estimate valid when the first estimate's deadline passes", async () => {
    adapters.post.mockImplementation(async (_path, request) =>
      makeResponse(request.mode, Math.floor(Date.now() / 1000))
    );
    await click("Use my location");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await input("Starting address", "Selected Google address");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')?.textContent
    ).toContain("Estimated");
    expect(container.textContent).not.toContain("This estimate expired");
    expect(adapters.post).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toContain("This estimate expired");
    expect(adapters.post).toHaveBeenCalledTimes(2);
  });

  // refuse cross-route cache snapshots without using a saved origin
  it.each(["key", "date", "terminalId", "mateId"] as const)(
    "rejects a refreshed schedule with a different %s before paid work",
    async (field) => {
      const refresh = vi.fn(async () => ({
        ...schedule,
        [field]: "different",
      }));
      await act(async () => {
        root.render(
          <SailingRecommendationCard
            schedule={schedule}
            onRefreshSchedule={refresh}
          />
        );
      });
      await input("Starting address", "Selected Google address");
      expect(refresh).toHaveBeenCalledOnce();
      expect(adapters.post).not.toHaveBeenCalled();
      expect(container.textContent).toContain(
        "Could not refresh the ferry schedule. Try again."
      );
      expect(
        (
          container.querySelector(
            '[aria-label="Starting address"]'
          ) as HTMLInputElement
        ).value
      ).toBe("");
    }
  );

  // reuse the frozen server bands instead of making another paid call
  it("changes the selected sailing while keeping capacity at arrival and one request", async () => {
    await click("Use my location");
    await input("Safety buffer (minutes)", "25");
    expect(adapters.post).toHaveBeenCalledOnce();
    await expandChance("Estimated");
    expect(container.textContent).toContain("Safety buffer25 minutes");
    expect(container.textContent).toContain(
      "Estimated drive-up spaces at arrival25"
    );
    expect(
      window.localStorage.getItem("ferry-fyi-sailing-buffer-minutes")
    ).toBe("25");
    expect(window.localStorage.length).toBe(1);
  });
  // show warnings without borrowing the vehicle model for pedestrians
  it("invalidates on mode change and renders non-driving warnings", async () => {
    await click("Use my location");
    await click("Walk");
    const modeButtons = Array.from(container.querySelectorAll("button")).slice(
      0,
      4
    );
    expect(modeButtons.map((button) => button.ariaPressed)).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
    expect(adapters.post).toHaveBeenCalledOnce();
    await click("Use my location");
    expect(container.textContent).toContain(
      "Use caution on walking and cycling routes."
    );
    expect(container.textContent).not.toContain("Estimated drive-up spaces");
  });
  // expire without reacquiring location or retrying the provider
  it("discards expired bands and requires another explicit estimate", async () => {
    await click("Use my location");
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(container.textContent).toContain("This estimate expired");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(adapters.location).toHaveBeenCalledOnce();
  });
  // reject older capacity and cancellation revisions on the displayed schedule
  it("invalidates material schedule changes without paid work", async () => {
    await click("Use my location");
    const changed = {
      ...schedule,
      slots: schedule.slots.map((slot) => ({
        ...slot,
        cancellationReason: "Weather",
      })),
    };
    await act(async () => {
      root.render(<SailingRecommendationCard schedule={changed} />);
    });
    expect(container.textContent).toContain("schedule changed");
    expect(adapters.post).toHaveBeenCalledOnce();
  });
  // ignore an old response after the travel method changes
  it("does not revive a request completed for another mode", async () => {
    let resolve!: (value: SailingRecommendationResponse) => void;
    adapters.post.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await click("Use my location");
    await click("Transit");
    await act(async () => {
      resolve(makeResponse());
    });
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
    expect(container.textContent).not.toContain("Estimating your trip");
  });
  // keep provider failure contained within the card
  it("renders disabled and ferry-recursion failures without arrival data", async () => {
    adapters.post.mockResolvedValue(
      unavailableRecommendation("drive", "configuration-unavailable", NOW)
    );
    await click("Use my location");
    expect(container.textContent).toContain(
      "Travel estimates are not enabled yet"
    );
    expect(container.textContent).toContain("Schedule tab");
    expect(container.textContent).not.toContain("schedule below");
    adapters.post.mockResolvedValue(
      unavailableRecommendation("drive", "ferry-route-recursion", NOW)
    );
    await click("Use my location");
    expect(container.textContent).toContain("Try a land-based origin");
    expect(container.textContent).not.toContain("Estimated terminal arrival");
  });
  // keep attribution below the whole card and traffic severity accessible
  it.each(["light", "moderate", "heavy", null] as const)(
    "renders %s traffic without an inline provider credit",
    async (level) => {
      const response = makeResponse();
      response.trafficLevel = level;
      adapters.post.mockResolvedValue(response);
      await click("Use my location");
      const arrival = Array.from(container.querySelectorAll("p")).find(
        (p) => p.textContent === "Estimated terminal arrival"
      );
      const time = arrival?.nextElementSibling;
      const severityClasses = {
        light: "text-green-dark",
        moderate: "text-amber-700",
        heavy: "text-red-700",
      };
      expect(time?.className).toContain(
        level === null ? "text-4xl" : severityClasses[level]
      );
      expect(arrival?.parentElement?.textContent).not.toContain("Google Maps");
      expect(container.querySelector("section")?.textContent).not.toContain(
        "Google Maps"
      );
      const credit = container.querySelector('[translate="no"]');
      expect(credit?.textContent).toContain("Google Maps");
      expect(credit?.classList.contains("text-xs")).toBe(true);
      expect(credit?.parentElement?.classList.contains("bg-white")).toBe(false);
      expect(credit?.parentElement?.classList.contains("rounded-2xl")).toBe(
        false
      );
      expect(credit?.previousElementSibling).toBe(
        container.querySelector("section")
      );
      expect(container.textContent).toContain(
        level === null
          ? "Traffic unavailable"
          : `${level[0].toUpperCase()}${level.slice(1)} traffic`
      );
    }
  );

  // keep each column concise and identify the assigned vessel
  it("shows Earlier, Estimated and Later with vessel names and chevrons", async () => {
    schedule.slots.forEach((slot, index) => {
      // retain real display names rather than numbered test vessels
      slot.vessel.name = ["Wenatchee", "Puyallup", "Tacoma"][index];
    });
    await click("Use my location");
    const columns = Array.from(
      container.querySelector('[aria-label="Sailing estimates"]')!.children
    );
    expect(
      columns.map((column) => column.firstElementChild?.textContent)
    ).toEqual(["Earlier", "Estimated", "Later"]);
    expect(
      columns.map((column) => column.querySelectorAll("p")[2]?.textContent)
    ).toEqual(["Wenatchee", "Puyallup", "Tacoma"]);
    expect(container.textContent).not.toContain("Estimated chance");
    const button = columns[1].querySelector("button")!;
    expect(button.querySelector('svg[data-direction="down"]')).not.toBeNull();
    expect(button.textContent).not.toMatch(/[+−]/);
    await expandChance("Estimated");
    expect(button.ariaExpanded).toBe("true");
    expect(button.querySelector('svg[data-direction="up"]')).not.toBeNull();
    expect(
      container.querySelector("#sailing-chance-details")?.textContent
    ).not.toContain("Planning ranges use");
    expect(container.textContent).toContain(
      "Lines outside the toll booth are not included."
    );
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // avoid replacing missing vessel names with internal fleet identifiers
  it.each(["25", "Vessel 25", "Boat 1"])(
    "shows an unavailable name instead of the placeholder %s",
    async (name) => {
      schedule.slots[1].vessel.name = name;
      await click("Use my location");
      const center = container.querySelector(
        '[aria-label="Sailing estimates"]'
      )!.children[1];
      expect(center.querySelectorAll("p")[2]?.textContent).toBe(
        "Vessel unavailable"
      );
      await expandChance("Estimated");
      expect(
        container.querySelector("#sailing-chance-details h3")?.textContent
      ).toContain("Vessel unavailable");
    }
  );

  // match time and percentage colors at both displayed thresholds
  it.each([
    [0.3, "30%", "text-red-700"],
    [0.31, "30%", "text-red-700"],
    [0.325, "35%", "text-orange-700"],
    [0.65, "65%", "text-orange-700"],
    [0.675, "70%", "text-green-dark"],
    [0.69, "70%", "text-green-dark"],
    [0.7, "70%", "text-green-dark"],
  ] as const)("colors a %s chance as %s", async (probability, label, color) => {
    const response = makeResponse("walk");
    // make all public marginal and buffer probabilities coherent
    response.sailingAssessments!.forEach((sailing) => {
      sailing.chance.probabilities = Array(61).fill(probability);
      sailing.chance.timingProbabilities = Array(61).fill(probability);
    });
    adapters.post.mockResolvedValue(response);
    await click("Walk");
    await click("Use my location");
    const columns = Array.from(
      container.querySelector('[aria-label="Sailing estimates"]')!.children
    );
    // apply the requested color to every time and percentage
    for (const column of columns) {
      expect(column.querySelectorAll("p")[1]?.classList.contains(color)).toBe(
        true
      );
      expect(column.querySelector("button")?.textContent).toContain(label);
      expect(column.querySelector("button")?.classList.contains(color)).toBe(
        true
      );
    }
  });

  // remove only the unwanted route notice while preserving safety warnings
  it("hides the tools or tolls notice without dropping other route warnings", async () => {
    const response = makeResponse();
    response.warnings = [
      "This route has tools",
      "This route has tolls.",
      "Use caution on restricted roads.",
    ];
    adapters.post.mockResolvedValue(response);
    await click("Use my location");
    expect(container.textContent).not.toContain("This route has tools");
    expect(container.textContent).not.toContain("This route has tolls");
    expect(container.textContent).toContain("Use caution on restricted roads.");
  });

  // preserve unavailable inventory and direct zero without false precision
  it("distinguishes missing capacity, direct zero and modeled tails", async () => {
    const response = makeResponse();
    const assessments = response.sailingAssessments!;
    const selected = assessments.find(
      (sailing) => sailing.scheduledDepartureAt === NOW + 2400
    )!;
    const next = assessments.find(
      (sailing) => sailing.scheduledDepartureAt === NOW + 4800
    )!;
    selected.chance.probabilities = Array(61).fill(null);
    selected.chance.capacityProbability = null;
    selected.chance.depletionRateRange = null;
    selected.spacesAtArrivalRange = null;
    selected.capacity!.state = "unavailable";
    selected.capacity!.predictedSpacesAtArrival = null;
    next.capacity!.state = "already-full";
    next.capacity!.predictedSpacesAtArrival = 0;
    next.capacity!.observedSpacesAtAnchor = 0;
    next.capacity!.fillAt = null;
    next.chance.probabilities = Array(61).fill(0);
    next.chance.capacityProbability = 0;
    next.chance.depletionRateRange = null;
    next.spacesAtArrivalRange = { minimum: 0, maximum: 0 };
    adapters.post.mockResolvedValue(response);
    await click("Use my location");
    expect(
      container.querySelector('button[aria-label^="Estimated:"]')?.textContent
    ).toContain("Unknown");
    expect(
      container.querySelector('button[aria-label^="Later:"]')?.textContent
    ).toContain("0%");
    const columns = container.querySelector(
      '[aria-label="Sailing estimates"]'
    )!.children;
    expect(
      columns[1].querySelectorAll("p")[1]?.classList.contains("text-gray-dark")
    ).toBe(true);
    expect(
      columns[2].querySelectorAll("p")[1]?.classList.contains("text-red-700")
    ).toBe(true);
    expect(
      columns[1].querySelector("button")?.classList.contains("text-gray-dark")
    ).toBe(true);
    expect(
      columns[2].querySelector("button")?.classList.contains("text-red-700")
    ).toBe(true);
    await expandChance("Estimated");
    expect(container.textContent).toContain("Timing alone cannot establish");
    await expandChance("Earlier");
    expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(
      1
    );
    expect(container.textContent).not.toContain(
      "Timing alone cannot establish"
    );
  });

  // retain neighboring chance data and locally switch the active buffer
  it("shows three sailings with independently expandable model details", async () => {
    await click("Use my location");
    const buttons = container.querySelectorAll(
      'button[aria-controls="sailing-chance-details"]'
    );
    expect(buttons).toHaveLength(3);
    expect(
      container.querySelector("#sailing-chance-details")?.hasAttribute("hidden")
    ).toBe(true);
    await expandChance("Earlier");
    expect(
      container.querySelector("#sailing-chance-details")?.hasAttribute("hidden")
    ).toBe(false);
    expect(container.textContent).toContain("Planning arrival range");
    expect(container.textContent).toContain(
      "Modeled spaces across arrival range"
    );
    expect(container.textContent).not.toContain("assumed independent");
    await expandChance("Earlier");
    expect(
      container.querySelector("#sailing-chance-details")?.hasAttribute("hidden")
    ).toBe(true);
    await input("Safety buffer (minutes)", "25");
    expect(container.textContent).toContain("No later sailing");
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // render modeled extremes coarsely rather than claiming certainty
  it("uses bounded chance labels and handles missing neighbors", async () => {
    const response = makeResponse();
    response.sailingAssessments![0].chance.probabilities = Array(61).fill(0);
    adapters.post.mockResolvedValue(response);
    await click("Use my location");
    expect(
      container.querySelector('button[aria-label^="Earlier:"]')?.textContent
    ).toContain("<5%");
    expect(
      container.querySelector('button[aria-label^="Later:"]')?.textContent
    ).toContain(">95%");
    expect(container.textContent).not.toContain("100%");
    await input("Safety buffer (minutes)", "25");
    expect(container.textContent).toContain("No later sailing");
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // remove the warning even when the point selector records advisory timing
  it("does not display tight timing and keeps pedestrian details timing-only", async () => {
    schedule.slots[1].time = NOW + 1800;
    await act(async () => {
      root.render(<SailingRecommendationCard schedule={schedule} />);
    });
    await click("Use my location");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')?.textContent
    ).toContain("Estimated");
    expect(container.textContent).not.toContain("Tight timing");
    await expandChance("Estimated");
    expect(container.textContent).not.toContain("WSF advises");
    await click("Walk");
    await click("Use my location");
    await expandChance("Estimated");
    expect(container.textContent).toContain("Timing chance with buffer");
    expect(container.textContent).not.toContain("drive-up spaces");
    expect(container.textContent).not.toContain("Space remaining chance");
  });

  // invalidate displayed names and timing-recovery inputs without another request
  it("expires when a displayed vessel or recovery input changes", async () => {
    await click("Use my location");
    const changed = {
      ...schedule,
      slots: schedule.slots.map((slot) => {
        // update a material displayed and projected input
        return {
          ...slot,
          vessel: { ...slot.vessel, name: "Changed vessel", horsepower: 999 },
        };
      }),
    };
    await act(async () => {
      root.render(<SailingRecommendationCard schedule={changed} />);
    });
    expect(container.textContent).toContain("schedule changed");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // distinguish same-time candidates by their snapshot sailing identity
  it("expands the selected same-time vessel rather than its cancelled neighbor", async () => {
    const chosen = {
      ...schedule.slots[1],
      vessel: {
        ...schedule.slots[1].vessel,
        id: "chosen",
        name: "Chosen vessel",
      },
    };
    schedule.slots[1].cancellationReason = "tidal";
    schedule.slots.splice(2, 0, chosen);
    await act(async () => {
      root.render(<SailingRecommendationCard schedule={schedule} />);
    });
    await click("Use my location");
    const center = container.querySelector('[aria-label="Sailing estimates"]')
      ?.children[1];
    expect(center?.textContent).toContain("Chosen vessel");
    await expandChance("Estimated");
    expect(container.textContent).toContain(
      "Estimated drive-up spaces at arrival20"
    );
    expect(container.textContent).toContain(
      "Modeled spaces across arrival range"
    );
    await expandChance("Earlier");
    expect(container.textContent).toContain("This sailing is cancelled");
    expect(container.textContent).not.toContain(
      "Estimated drive-up spaces at arrival"
    );
  });

  // qualify deterministic failure without contradicting surviving modeled tails
  it("shows nonzero alternatives when no sailing fits the point estimate", async () => {
    const response = makeResponse();
    const outcome = {
      result: "no-catchable-sailing" as const,
      sailing: null,
      skipped: [],
    };
    response.outcome = outcome;
    response.bufferOutcomeBands = [
      { minimumBufferMinutes: 0, maximumBufferMinutes: 60, outcome },
    ];
    adapters.post.mockResolvedValue(response);
    await click("Use my location");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')?.textContent
    ).toContain("Estimated");
    expect(container.textContent).toContain(
      "No sailing fits the point arrival and buffer"
    );
    expect(container.textContent).not.toContain(
      "No remaining sailing fits this trip"
    );
    expect(
      container.querySelector('button[aria-label^="Estimated:"]')?.textContent
    ).not.toContain("0%");
  });

  // tolerate coherent old servers without inventing modeled chances
  it("renders a legacy point response with unavailable chance", async () => {
    const response = makeResponse();
    delete response.sailingAssessments;
    delete response.travelUncertainty;
    adapters.post.mockResolvedValue(response);
    await click("Use my location");
    expect(container.textContent).toContain("Unknown");
    expect(container.textContent).toContain("No earlier sailing");
    expect(container.textContent).toContain("No later sailing");
  });

  // reject malformed modeled data instead of displaying a fabricated percentage
  it("rejects unsafe chance models, joint bounds and buffer increases", async () => {
    const trip = {
      arrivingTerminalId: "5",
      departingTerminalId: "14",
      bufferMinutes: 5,
      mode: "drive" as const,
      origin: { kind: "address" as const, address: "Synthetic test origin" },
    };
    // mutate isolated responses to cover each boundary failure
    for (const mutate of [
      (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.probabilities[0] = 2;
      },
      (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.probabilities[0] = 1;
        value.sailingAssessments![0].chance.timingProbabilities[0] = 0;
      },
      (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.probabilities[1] = 1;
      },
      (value: SailingRecommendationResponse) => {
        Object.assign(value.sailingAssessments![0].chance, { rawRoutes: [] });
      },
      (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.basis = "timing-only";
      },
      (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].eligibilityReason = "cancelled";
      },
      (value: SailingRecommendationResponse) => {
        delete value.travelUncertainty;
      },
      (value: SailingRecommendationResponse) => {
        const { chance } = value.sailingAssessments![1];
        chance.probabilities = Array(61).fill(null);
        chance.capacityProbability = null;
        chance.depletionRateRange = null;
        value.sailingAssessments![1].spacesAtArrivalRange = null;
      },
      (value: SailingRecommendationResponse) => {
        value.outcome.sailing!.sailingId = "missing-snapshot-id";
      },
      (value: SailingRecommendationResponse) => {
        delete value.outcome.sailing!.sailingId;
      },
      (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].capacity!.state = "unavailable";
      },
      (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].capacity!.state = "already-full";
      },
      (value: SailingRecommendationResponse) => {
        value.travelUncertainty!.earliestArrivalAt = value.arrivalAt! + 1;
      },
    ]) {
      const value = makeResponse();
      mutate(value);
      adapters.post.mockResolvedValue(value);
      await expect(getSailingRecommendation(trip)).rejects.toThrow(
        "Sailing estimate unavailable"
      );
    }
  });

  // refuse undeclared provider fields at every public boundary
  it("rejects raw routes, nested origin data and malformed bands", async () => {
    const trip = {
      arrivingTerminalId: "5",
      bufferMinutes: 5,
      departingTerminalId: "14",
      mode: "drive" as const,
      origin: { kind: "address" as const, address: "Synthetic test origin" },
    };
    const response = makeResponse();
    adapters.post.mockResolvedValue({ ...response, origin: trip.origin });
    await expect(getSailingRecommendation(trip)).rejects.toThrow(
      "Sailing estimate unavailable"
    );
    adapters.post.mockResolvedValue({
      ...response,
      outcome: { ...response.outcome, rawRoutes: [] },
    });
    await expect(getSailingRecommendation(trip)).rejects.toThrow(
      "Sailing estimate unavailable"
    );
    adapters.post.mockResolvedValue({
      ...response,
      bufferOutcomeBands: [
        { ...response.bufferOutcomeBands[0], maximumBufferMinutes: 2 },
      ],
    });
    await expect(getSailingRecommendation(trip)).rejects.toThrow(
      "Sailing estimate unavailable"
    );
  });
});
