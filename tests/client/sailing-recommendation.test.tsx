// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SailingRecommendationResponse } from "shared/contracts/sailingRecommendations";
import type { Schedule, Slot } from "shared/contracts/schedules";
import { unavailableRecommendation } from "shared/lib/sailingRecommendationResponse";
import {
  getLegacySailingRecommendationRevision,
  getRecommendationServiceDate,
  getSailingRecommendationRevision,
} from "shared/lib/sailingRecommendationRevision";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../client/lib/api";
import { getSailingRecommendation } from "../../client/lib/sailingRecommendations";
import { SailingEstimateResults } from "../../client/views/Schedule/SailingEstimateResults";
import { SailingRecommendationCard } from "../../client/views/Schedule/SailingRecommendationCard";
import { createTravelUncertainty } from "../../server/lib/sailingChance";
import {
  buildRecommendationBands,
  buildSailingAssessments,
} from "../../server/lib/sailingRecommendations";

const adapters = vi.hoisted(() => ({
  post: vi.fn(),
  location: vi.fn(),
  canShare: vi.fn(),
  share: vi.fn(),
  clipboard: vi.fn(),
}));
const analytics = vi.hoisted(() => ({
  trackUsefulEvent: vi.fn(),
}));
vi.mock("@capacitor/share", () => ({
  Share: { canShare: adapters.canShare, share: adapters.share },
}));
vi.mock("~/lib/analytics", () => analytics);
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

// return the current deterministic schedule fixture
const refreshSchedule = (): Promise<Schedule> => Promise.resolve(schedule);

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
  asOf = NOW,
  durationSeconds = 1200
): SailingRecommendationResponse => {
  const candidateInput = {
    arrivalAt: asOf + durationSeconds,
    asOf,
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
    durationSeconds,
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
    arrivalAt: asOf + durationSeconds,
    attribution: "Google Maps",
    bufferOutcomeBands: bands,
    capacityWatermark: null,
    durationSeconds,
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
  window.history.replaceState(
    { idx: 3, key: "test" },
    "",
    "/clinton/mukilteo/navigation"
  );
  adapters.canShare.mockResolvedValue({ value: false });
  adapters.share.mockResolvedValue({});
  adapters.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: adapters.clipboard },
  });
  schedule = makeSchedule();
  adapters.location.mockResolvedValue({ latitude: 47.9, longitude: -122.3 });
  adapters.post.mockImplementation(async (_path, request) =>
    makeResponse(request.mode)
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SailingRecommendationCard
        onRefreshSchedule={refreshSchedule}
        schedule={schedule}
      />
    );
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
  // safety margins choose a safer boat without delaying the rider's actual arrival
  it.each(["drive", "walk", "bicycle", "transit", "forecast"] as const)(
    "shows physical boarding chance rather than buffer-readiness chance for %s",
    async (source) => {
      const mode = source === "forecast" ? "drive" : source;
      schedule.slots[0].time = NOW + 25 * 60;
      // isolate timing risk with ample known vehicle inventory
      for (const slot of schedule.slots) {
        slot.estimate!.driveUpCapacity = 30;
      }
      const response = makeResponse(mode, NOW, 19 * 60);
      const first = response.sailingAssessments![0];
      // retain the independent forecast multiplier when live inventory is missing
      if (source === "forecast") {
        first.capacity!.state = "unavailable";
        first.capacity!.predictedSpacesAtArrival = null;
        delete first.capacity!.projection;
        first.chance.capacityProbability = 0.8;
        first.chance.forecastFullProbability = 0.2;
        first.chance.depletionRateRange = null;
        first.spacesAtArrivalRange = null;
        first.chance.probabilities = first.chance.timingProbabilities.map(
          // apply the sailing's forecast risk at each readiness target
          (timing) => timing * 0.8
        );
      }
      expect(first.chance.probabilities[0]).toBeGreaterThanOrEqual(0.8);
      expect(first.chance.probabilities[5]).toBeLessThanOrEqual(0.05);
      expect(response.arrivalAt! + 5 * 60).toBeGreaterThan(
        first.projectedDepartureAt - first.operatorCutoffSeconds
      );
      adapters.post.mockResolvedValue(response);
      await act(() => {
        root.render(
          <SailingRecommendationCard
            onRefreshSchedule={refreshSchedule}
            schedule={schedule}
          />
        );
      });
      // use the same production input boundary for each travel method
      if (mode !== "drive") {
        await click(
          { walk: "Walk", bicycle: "Cycle", transit: "Transit" }[mode]
        );
      }
      await click("Use my location");
      const expectedChance = source === "forecast" ? "80%" : ">95%";
      const firstBlock = container.querySelector(
        `button[data-departure-at="${first.projectedDepartureAt}"]`
      )!;
      expect(
        firstBlock.querySelector("[data-sailing-label]")?.textContent
      ).toBe("Earlier");
      expect(
        firstBlock.querySelector("[data-sailing-chance]")?.textContent
      ).toBe(expectedChance);
      expect(
        firstBlock
          .querySelector("[data-sailing-time]")
          ?.classList.contains("text-green-dark")
      ).toBe(true);
      expect(firstBlock.getAttribute("aria-label")).toContain(expectedChance);
      await input("Safety buffer (minutes)", "0");
      const nowSelected = container.querySelector(
        `button[data-departure-at="${first.projectedDepartureAt}"]`
      )!;
      expect(
        nowSelected.querySelector("[data-sailing-label]")?.textContent
      ).toBe("Estimated");
      expect(
        nowSelected.querySelector("[data-sailing-chance]")?.textContent
      ).toBe(expectedChance);
      expect(adapters.post).toHaveBeenCalledOnce();
    }
  );

  // a displayed response must not retain a positive or unknown chance after departure
  it.each([false, true])(
    "turns elapsed sailings into exact red zero with unknown=%s",
    async (unknown) => {
      const response = makeResponse();
      const sailing = response.sailingAssessments![1];
      sailing.projectedDepartureAt = NOW + 1;
      response.outcome.sailing = sailing;
      // retain missing inventory to prove departure wins even without a numeric chance
      if (unknown) {
        sailing.chance.probabilities = Array(61).fill(null);
      }
      await act(() => {
        root.render(
          <SailingEstimateResults
            buffer={5}
            outcome={response.outcome}
            response={response}
          />
        );
      });
      await act(() => {
        vi.advanceTimersByTime(1000);
      });
      const button = container.querySelector(
        'button[aria-label^="Estimated:"]'
      );
      expect(button?.querySelector("[data-sailing-chance]")?.textContent).toBe(
        "0%"
      );
      expect(
        button
          ?.querySelector("[data-sailing-chance]")
          ?.classList.contains("text-red-700")
      ).toBe(true);
      await expandChance("Estimated");
      expect(
        container.querySelector("#sailing-chance-details [data-capacity-index]")
      ).not.toBeNull();
      expect(adapters.post).not.toHaveBeenCalled();
    }
  );

  // accept explicitly forecast-backed chance without inventing live capacity details
  it("renders numeric forecast chances without live capacity details", async () => {
    const response = makeResponse();
    const selected = response.sailingAssessments![1];
    selected.capacity!.state = "unavailable";
    selected.capacity!.predictedSpacesAtArrival = null;
    delete selected.capacity!.projection;
    selected.chance.forecastFullProbability = 0.2;
    selected.chance.capacityProbability = 0.8;
    selected.chance.depletionRateRange = null;
    selected.spacesAtArrivalRange = null;
    selected.chance.probabilities = selected.chance.timingProbabilities.map(
      // apply the coherent forecast fallback across timing chances
      (timing) => timing * 0.8
    );
    adapters.post.mockResolvedValue(response);
    await click("Use my location");
    expect(
      container.querySelector(
        'button[aria-label^="Estimated:"] [data-sailing-chance]'
      )?.textContent
    ).toBe("80%");
    await expandChance("Estimated");
    expect(container.querySelector("#sailing-chance-details dl")).toBeNull();
    expect(container.querySelector('[data-capacity-index="1"]')).toBeNull();
    expect(container.textContent).not.toContain(
      "Timing alone cannot establish"
    );
  });

  // name each forecast inconsistency in the test report
  it.each([
    {
      name: "an out-of-range full probability",
      // exceed the probability range
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].chance.forecastFullProbability = 2;
      },
    },
    {
      name: "a mismatched capacity probability",
      // contradict the forecast complement
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].chance.capacityProbability = 0.7;
      },
    },
    {
      name: "a live capacity state",
      // combine forecast fallback with live fullness
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].capacity!.state = "already-full";
      },
    },
    {
      name: "a mismatched joint probability",
      // contradict the forecast-weighted timing chance
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].chance.probabilities[5] = 0.4;
      },
    },
  ])("rejects a forecast response with $name", async ({ mutate }) => {
    const response = makeResponse();
    const selected = response.sailingAssessments![1];
    selected.capacity!.state = "unavailable";
    selected.capacity!.predictedSpacesAtArrival = null;
    delete selected.capacity!.projection;
    selected.chance.forecastFullProbability = 0.2;
    selected.chance.capacityProbability = 0.8;
    selected.chance.depletionRateRange = null;
    selected.spacesAtArrivalRange = null;
    selected.chance.probabilities = selected.chance.timingProbabilities.map(
      // establish the valid fallback before corrupting one field
      (timing) => timing * 0.8
    );
    const trip = {
      arrivingTerminalId: "5",
      departingTerminalId: "14",
      bufferMinutes: 5,
      mode: "drive" as const,
      origin: { kind: "address" as const, address: "Synthetic test origin" },
    };
    mutate(response);
    adapters.post.mockResolvedValue(response);
    await expect(getSailingRecommendation(trip)).rejects.toThrow(
      "Sailing estimate unavailable"
    );
  });

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
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
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
    expect(container.querySelector("#sailing-chance-details dl")).toBeNull();
    expect(container.querySelector("[data-arrival-caption]")?.textContent).toBe(
      "ETA"
    );
    expect(container.textContent).not.toContain("Arrival + buffer");
    expect(container.textContent).not.toContain(
      "assumed triangular distributions"
    );
    expect(container.textContent).not.toMatch(/provisional/i);
  });

  // qualify only the usable outcome returned for each explicit request
  it.each([
    ["drive", "recommended", "recommended"],
    ["walk", "timing-only", "timing_only"],
    ["bicycle", "recommended", "recommended"],
    ["transit", "timing-only", "timing_only"],
  ] as const)(
    "tracks a usable %s %s estimate once per request",
    async (mode, result, analyticsResult) => {
      const response = makeResponse(mode);
      const selectedBand = response.bufferOutcomeBands.find(
        // select the request's original five-minute result
        (band) =>
          band.minimumBufferMinutes <= 5 && band.maximumBufferMinutes >= 5
      );
      expect(selectedBand?.outcome.sailing).not.toBeNull();
      selectedBand!.outcome = {
        ...selectedBand!.outcome,
        result,
      };
      response.outcome = selectedBand!.outcome;
      adapters.post.mockResolvedValue(response);

      // choose the requested mode without starting an estimate
      if (mode !== "drive") {
        await click(
          { walk: "Walk", bicycle: "Cycle", transit: "Transit" }[mode]
        );
      }
      await click("Use my location");

      expect(analytics.trackUsefulEvent).toHaveBeenCalledTimes(1);
      expect(analytics.trackUsefulEvent).toHaveBeenLastCalledWith(
        "trip_plan_available",
        { result: analyticsResult, travel_mode: mode }
      );

      await input("Safety buffer (minutes)", "0");
      await act(() => {
        root.render(
          <SailingRecommendationCard
            onRefreshSchedule={refreshSchedule}
            schedule={schedule}
          />
        );
      });
      expect(analytics.trackUsefulEvent).toHaveBeenCalledTimes(1);

      await click("Use my location");
      expect(analytics.trackUsefulEvent).toHaveBeenCalledTimes(2);
    }
  );

  // keep failed, unusable and stale outcomes silent
  it.each([
    "routing-unavailable",
    "schedule-unavailable",
    "no-catchable-sailing",
    "stale",
    "expired",
  ] as const)("does not qualify a %s estimate", async (kind) => {
    // build the exact nonqualifying response shape
    if (kind === "routing-unavailable" || kind === "schedule-unavailable") {
      adapters.post.mockResolvedValue(
        unavailableRecommendation(
          "drive",
          kind === "schedule-unavailable"
            ? "schedule-unavailable"
            : "provider-unavailable",
          NOW
        )
      );
    } else {
      const response = makeResponse();
      if (kind === "stale") {
        response.revision = "superseded-schedule-revision";
      } else if (kind === "expired") {
        response.validUntil = NOW;
      } else {
        const selectedBand = response.bufferOutcomeBands.find(
          // select the request's original five-minute result
          (band) =>
            band.minimumBufferMinutes <= 5 && band.maximumBufferMinutes >= 5
        );
        selectedBand!.outcome = {
          ...selectedBand!.outcome,
          result: "no-catchable-sailing",
          sailing: null,
        };
        response.outcome = selectedBand!.outcome;
      }
      adapters.post.mockResolvedValue(response);
    }

    await click("Use my location");

    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
  });
  // restore shared controls without silently acquiring location or paid directions
  it("restores URL controls, syncs edits and retains router history state", async () => {
    window.localStorage.setItem("ferry-fyi-sailing-buffer-minutes", "18");
    window.history.replaceState(
      { idx: 3, key: "test" },
      "",
      "/clinton/mukilteo/navigation?tripMode=transit&tripBuffer=7&keep=yes#anchor&tripAddress=Shared+Starting+Address"
    );
    await act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.textContent
    ).toBe("Transit");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Safety buffer (minutes)"]'
      )?.value
    ).toBe("7");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Starting address"]'
      )?.value
    ).toBe("Shared Starting Address");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
    await input("Starting address", "123 A&B Street #4");
    await click("Walk");
    await input("Safety buffer (minutes)", "0");
    const url = new URL(window.location.href);
    expect(url.searchParams.get("tripMode")).toBe("walk");
    expect(url.searchParams.get("tripBuffer")).toBe("0");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(new URLSearchParams(url.hash.slice(1)).get("tripAddress")).toBe(
      "123 A&B Street #4"
    );
    expect(url.hash).toContain("anchor&");
    expect(url.search).not.toContain("Street");
    expect(window.history.state).toEqual({ idx: 3, key: "test" });
    expect(window.localStorage.length).toBe(1);
  });

  // show results-shaped placeholders throughout the pending explicit estimate
  it.each(["success", "failure"])(
    "shows an accessible skeleton until %s",
    async (outcome) => {
      let resolve: (value: SailingRecommendationResponse) => void = () =>
        undefined;
      adapters.post.mockReturnValue(
        new Promise<SailingRecommendationResponse>((finish) => {
          resolve = finish;
        })
      );
      await click("Use my location");
      expect(
        container
          .querySelector('[aria-label="Estimating your trip"]')
          ?.getAttribute("aria-busy")
      ).toBe("true");
      expect(
        container.querySelectorAll(
          '[aria-label="Estimating your trip"] .skeleton'
        ).length
      ).toBeGreaterThan(10);
      expect(container.textContent).not.toContain("Estimating your trip…");
      expect(
        container.querySelector('[aria-label="Sailing estimates"]')
      ).toBeNull();
      await act(async () => {
        resolve(
          outcome === "success"
            ? makeResponse()
            : unavailableRecommendation("drive", "provider-unavailable", NOW)
        );
      });
      expect(
        container.querySelector('[aria-label="Estimating your trip"]')
      ).toBeNull();
      // only successful provider results have sailing blocks
      if (outcome === "success") {
        expect(
          container.querySelector('[aria-label="Sailing estimates"]')
        ).not.toBeNull();
      } else {
        expect(container.textContent).toContain(
          "A travel estimate is unavailable."
        );
        expect(
          container.querySelector('[aria-label="Sailing estimates"]')
        ).toBeNull();
      }
    }
  );

  // a shared page only restores controls until the recipient explicitly estimates
  it("restores all controls on remount without paid or location requests", async () => {
    await input("Starting address", "Shared reload origin");
    await click("Cycle");
    await input("Safety buffer (minutes)", "11");
    await act(() => {
      root.unmount();
      root = createRoot(container);
      root.render(
        <SailingRecommendationCard
          onRefreshSchedule={refreshSchedule}
          schedule={schedule}
        />
      );
    });
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Starting address"]'
      )?.value
    ).toBe("Shared reload origin");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.textContent
    ).toBe("Cycle");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Safety buffer (minutes)"]'
      )?.value
    ).toBe("11");
    expect(adapters.post).not.toHaveBeenCalled();
    expect(adapters.location).not.toHaveBeenCalled();
  });

  // history changes discard a pending result without a paid retry
  it("does not revive an estimate after restoring another shared origin", async () => {
    let resolve: (value: SailingRecommendationResponse) => void = () =>
      undefined;
    adapters.post.mockReturnValue(
      new Promise<SailingRecommendationResponse>((finish) => {
        resolve = finish;
      })
    );
    await click("Use my location");
    window.history.replaceState(
      window.history.state,
      "",
      "/clinton/mukilteo/navigation?tripMode=walk&tripBuffer=10#tripAddress=Another+Origin"
    );
    await act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await act(async () => {
      resolve(makeResponse());
    });
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Estimating your trip"]')
    ).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Starting address"]'
      )?.value
    ).toBe("Another Origin");
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
  });

  // unavailable clipboards must not masquerade as successful copies
  it("reports an unavailable share fallback honestly", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await click("Use my location");
    analytics.trackUsefulEvent.mockClear();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Share trip"]')
        ?.click();
    });
    expect(container.textContent).toContain(
      "Sharing is unavailable on this device."
    );
    expect(container.textContent).not.toContain("Link copied.");
    expect(adapters.share).not.toHaveBeenCalled();
    expect(adapters.clipboard).not.toHaveBeenCalled();
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
  });

  // share the current controls without retaining or sharing coordinates
  it.each([true, false])(
    "shares the address fragment with native=%s",
    async (native) => {
      adapters.canShare.mockResolvedValue({ value: native });
      await input("Starting address", "Synthetic shared origin");
      await click("Estimate trip");
      expect(
        container.querySelector<HTMLInputElement>(
          '[aria-label="Starting address"]'
        )?.value
      ).toBe("Synthetic shared origin");
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Share trip"]'
      );
      expect(button).not.toBeNull();
      analytics.trackUsefulEvent.mockClear();
      await act(async () => {
        button?.click();
      });
      const expectedUrl = window.location.href;
      expect(expectedUrl).toContain("#tripAddress=Synthetic+shared+origin");
      // a native sheet takes priority over clipboard fallback
      if (native) {
        expect(adapters.share).toHaveBeenCalledWith(
          expect.objectContaining({ url: expectedUrl })
        );
        expect(adapters.clipboard).not.toHaveBeenCalled();
      } else {
        expect(adapters.clipboard).toHaveBeenCalledWith(expectedUrl);
        expect(container.textContent).toContain("Link copied.");
      }
      expect(analytics.trackUsefulEvent).toHaveBeenCalledOnce();
      expect(analytics.trackUsefulEvent).toHaveBeenCalledWith(
        "share_completed",
        {
          method: native ? "share_sheet" : "clipboard",
          surface: "trip_plan",
        }
      );
      expect(JSON.stringify(analytics.trackUsefulEvent.mock.calls)).not.toMatch(
        /Synthetic shared origin|tripAddress|test-google-place-id/
      );
      expect(adapters.post).toHaveBeenCalledOnce();
      await click("Use my location");
      expect(window.location.hash).not.toContain("tripAddress");
      expect(window.location.href).not.toMatch(/latitude|longitude|47.9|122.3/);
    }
  );

  // rejected share sheets never become completed rider actions
  it("keeps a rejected trip share silent", async () => {
    adapters.canShare.mockResolvedValue({ value: true });
    adapters.share.mockRejectedValue(new Error("cancelled"));
    await click("Use my location");
    analytics.trackUsefulEvent.mockClear();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Share trip"]')
        ?.click();
    });

    expect(container.textContent).toContain("Could not share this trip.");
    expect(analytics.trackUsefulEvent).not.toHaveBeenCalled();
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
    ).toBe("Synthetic test origin");
    expect(window.localStorage.length).toBe(0);
    expect(window.location.search).not.toContain("Synthetic");
    expect(window.location.hash).toContain("tripAddress=Synthetic+test+origin");
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
        // edit the retained address before choosing the same mocked place again
        await input("Starting address", "");
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

  // validate a downgraded response against the prior protocol's material fingerprint
  it("renders a legacy-server fallback without false expiry or another refresh", async () => {
    const result = makeResponse();
    result.revision = getLegacySailingRecommendationRevision(schedule);
    const refresh = vi.fn(() => Promise.resolve(schedule));
    adapters.post
      .mockRejectedValueOnce(new ApiError(404, {}))
      .mockResolvedValueOnce(result);
    act(() => {
      root.render(
        <SailingRecommendationCard
          schedule={schedule}
          onRefreshSchedule={refresh}
        />
      );
    });

    await click("Use my location");

    expect(refresh).toHaveBeenCalledOnce();
    expect(adapters.post.mock.calls.map(([path]) => path)).toEqual([
      "/sailing-recommendations/v2",
      "/sailing-recommendations",
    ]);
    expect(container.textContent).not.toContain("This estimate expired");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).not.toBeNull();
  });

  // do not accept a legacy fingerprint from an explicitly current server
  it("keeps v2 schedule guards strict even when a revision matches v1", async () => {
    const result = makeResponse();
    result.revision = getLegacySailingRecommendationRevision(schedule);
    const refresh = vi.fn(() => Promise.resolve(schedule));
    adapters.post.mockResolvedValue(result);
    act(() => {
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

  // retain material schedule checks after a successful endpoint downgrade
  it("rejects a legacy-server fallback from a different material snapshot", async () => {
    const result = makeResponse();
    result.revision = "different-legacy-snapshot";
    const refresh = vi.fn(() => Promise.resolve(schedule));
    adapters.post
      .mockRejectedValueOnce(new ApiError(404, {}))
      .mockResolvedValueOnce(result);
    act(() => {
      root.render(
        <SailingRecommendationCard
          schedule={schedule}
          onRefreshSchedule={refresh}
        />
      );
    });

    await click("Use my location");

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(adapters.post).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("This estimate expired");
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')
    ).toBeNull();
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
      ).toBe("Selected Google address");
    }
  );

  // an explicit estimate opens its middle sailing without an extra user action
  it("selects Estimated by default and keeps exactly one whole block expanded", async () => {
    await click("Use my location");
    const blocks = Array.from(
      container.querySelectorAll('[aria-label="Sailing estimates"] > button')
    ) as HTMLButtonElement[];
    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.ariaExpanded)).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(
      container.querySelector("#sailing-chance-details figure")
    ).not.toBeNull();
    expect(blocks.every((block) => block.querySelector("svg") === null)).toBe(
      true
    );
    // clicking a time or vessel selects that entire block without collapse
    for (const [index, field] of [
      [0, "[data-sailing-time]"],
      [2, "[data-sailing-vessel]"],
      [1, "[data-sailing-label]"],
    ] as const) {
      await act(() =>
        (blocks[index].querySelector(field) as HTMLElement).click()
      );
      expect(blocks.map((block) => block.ariaExpanded)).toEqual(
        blocks.map((_, position) => (position === index ? "true" : "false"))
      );
      await act(() => blocks[index].click());
      expect(blocks[index].ariaExpanded).toBe("true");
    }
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // result identity resets the selected block even when sailing IDs are unchanged
  it("defaults a refreshed explicit estimate back to Estimated", async () => {
    await click("Use my location");
    await expandChance("Later");
    await click("Use my location");
    expect(
      container
        .querySelector('button[aria-label^="Estimated:"]')
        ?.getAttribute("aria-expanded")
    ).toBe("true");
    expect(
      container
        .querySelector('button[aria-label^="Later:"]')
        ?.getAttribute("aria-expanded")
    ).toBe("false");
    expect(adapters.post).toHaveBeenCalledTimes(2);
  });

  // switching changes only the selected sailing lane, not the shared trip frame
  it("keeps the Later endpoint, arrival lane and all capacity areas fixed across selections", async () => {
    await click("Use my location");
    const snapshot = () => {
      // capture everything outside the selected blue sailing lane
      const svg = container.querySelector(
        "#sailing-chance-details svg[role=img]"
      )!;
      return {
        start: svg.getAttribute("data-domain-start"),
        end: svg.getAttribute("data-domain-end"),
        width: svg.getAttribute("width"),
        height: svg.getAttribute("height"),
        arrival: svg.querySelector('[data-timeline-lane="arrival"]')!.innerHTML,
        capacity: svg.querySelector("[data-capacity-background]")!.innerHTML,
        axis: svg.querySelector('[data-timeline-lane="capacity"]')!.innerHTML,
      };
    };
    const original = snapshot();
    expect(Number(original.start)).toBe(NOW);
    expect(Number(original.end)).toBe(NOW + 4800);
    expect(container.querySelectorAll("[data-capacity-area]")).toHaveLength(3);
    // a later click must not move now or remove earlier areas
    for (const label of ["Earlier", "Later", "Estimated"]) {
      await act(() => vi.advanceTimersByTime(1000));
      await expandChance(label);
      expect(snapshot()).toEqual(original);
      expect(container.querySelectorAll("[data-capacity-area]")).toHaveLength(
        3
      );
    }
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // keep the result chart compact without the old detail title and statistics
  it("shows only the chart beneath the sailing blocks", async () => {
    await click("Use my location");
    const details = container.querySelector("#sailing-chance-details")!;
    expect(details.querySelector("figure")).not.toBeNull();
    expect(details.querySelector("h3, figcaption, dl, p")).toBeNull();
    expect(
      details.querySelector('[aria-label="Scrollable trip timing timeline"]')
    ).not.toBeNull();
  });

  // preserve page space without losing semantic grouping or estimate details
  it("renders the navigation form and expanded sailing details without card wrappers", async () => {
    await click("Use my location");
    await expandChance("Estimated");
    const section = container.querySelector("section")!;
    const details = container.querySelector("#sailing-chance-details")!;
    const figure = details.querySelector("figure")!;
    expect(section.getAttribute("aria-labelledby")).toBe(
      "sailing-recommendation-title"
    );
    // retain semantic grouping without bordered padded card containers
    for (const wrapper of [section, figure.parentElement!]) {
      expect(wrapper.className).not.toMatch(
        /rounded|shadow|ring-|bg-|border|\bp-[0-9]/
      );
    }
    expect(figure).not.toBeNull();
    expect(container.textContent).toContain(
      "Estimates do not guarantee boarding."
    );
  });

  // hidden assessments cannot extend the displayed trio or add capacity beyond Later
  it("retains three inventories ending at Later rather than a hidden following sailing", async () => {
    const response = makeResponse();
    const last = response.sailingAssessments!.at(-1)!;
    response.sailingAssessments!.push({
      ...last,
      sailingId: "following-sailing",
      projectedDepartureAt: NOW + 7200,
      scheduledDepartureAt: NOW + 7200,
    });
    adapters.post.mockResolvedValueOnce(response);
    await click("Use my location");
    await expandChance("Later");
    const svg = container.querySelector(
      "#sailing-chance-details svg[role=img]"
    )!;
    expect(Number(svg.getAttribute("data-domain-end"))).toBe(NOW + 4800);
    expect(svg.querySelectorAll("[data-capacity-area]")).toHaveLength(3);
    expect(
      svg.querySelector('[data-capacity-sailing="following-sailing"]')
    ).toBeNull();
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // structural ineligibility never becomes the next boarded sailing's inventory
  it.each(["cancelled", "mode-ineligible"] as const)(
    "skips a %s following assessment",
    async (eligibilityReason) => {
      const response = makeResponse();
      const last = response.sailingAssessments!.at(-1)!;
      response.sailingAssessments!.push({
        ...last,
        sailingId: "following-sailing",
        projectedDepartureAt: NOW + 7200,
        scheduledDepartureAt: NOW + 7200,
      });
      last.eligibilityReason = eligibilityReason;
      last.capacity = null;
      last.spacesAtArrivalRange = null;
      last.chance = {
        ...last.chance,
        capacityProbability: null,
        depletionRateRange: null,
        probabilities: Array(61).fill(0),
        timingProbabilities: Array(61).fill(0),
      };
      adapters.post.mockResolvedValueOnce(response);
      await click("Use my location");
      await expandChance("Estimated");
      const svg = container.querySelector(
        "#sailing-chance-details svg[role=img]"
      )!;
      expect(Number(svg.getAttribute("data-domain-end"))).toBe(NOW + 4800);
      expect(svg.querySelectorAll("[data-capacity-area]")).toHaveLength(2);
      expect(
        svg.querySelector('[data-capacity-sailing="following-sailing"]')
      ).toBeNull();
      expect(adapters.post).toHaveBeenCalledOnce();
    }
  );

  // reuse the frozen server bands instead of making another paid call
  it("changes the selected sailing while keeping capacity at arrival and one request", async () => {
    await click("Use my location");
    await input("Safety buffer (minutes)", "25");
    expect(adapters.post).toHaveBeenCalledOnce();
    await expandChance("Estimated");
    expect(
      container.querySelector('[data-timeline-range="Safety buffer"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-timeline-point="Arrival + buffer"]')
    ).toBeNull();
    // timing fields now share a chart rather than repeated definition rows
    expect(
      container.querySelector('figure[aria-label="Trip timing timeline"]')
    ).not.toBeNull();
    const timingLabels = [
      "Estimated arrival",
      "Arrival + buffer",
      "Arrival deadline with buffer",
      "Estimated departure",
      "Scheduled departure",
      "Estimated fill time",
      "WSF capacity observed",
    ];
    expect(
      Array.from(container.querySelectorAll("#sailing-chance-details dt"))
        .map((label) => label.textContent)
        .filter((label) => label !== null && timingLabels.includes(label))
    ).toEqual([]);
    expect(container.querySelector("#sailing-chance-details dl")).toBeNull();
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
      root.render(
        <SailingRecommendationCard
          onRefreshSchedule={refreshSchedule}
          schedule={changed}
        />
      );
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
      const marker = container.querySelector("[data-arrival-marker]")!;
      const caption = container.querySelector("[data-arrival-caption]")!;
      const expectedColor =
        level === null ? "text-gray-dark" : severityClasses[level];
      expect(marker.getAttribute("class")).toContain(expectedColor);
      expect(time?.className).toContain(marker.getAttribute("class"));
      expect(caption.parentElement?.getAttribute("class")).toBe(
        marker.getAttribute("class")
      );
      expect(marker.getAttribute("stroke")).toBe("currentColor");
      expect(caption.getAttribute("fill")).toBe("currentColor");
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
  it("shows Earlier, Estimated and Later with vessel names and no chance carets", async () => {
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
      columns.map(
        (column) => column.querySelector("[data-sailing-vessel]")?.textContent
      )
    ).toEqual(["Wenatchee", "Puyallup", "Tacoma"]);
    expect(container.textContent).not.toContain("Estimated chance");
    const button = columns[1] as HTMLButtonElement;
    expect(button.querySelector("svg")).toBeNull();
    expect(button.textContent).not.toMatch(/[+−]/);
    await expandChance("Estimated");
    expect(button.ariaExpanded).toBe("true");
    expect(button.querySelector("svg")).toBeNull();
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
      expect(center.querySelector("[data-sailing-vessel]")?.textContent).toBe(
        "Vessel unavailable"
      );
      await expandChance("Estimated");
      expect(container.querySelector("#sailing-chance-details h3")).toBeNull();
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
      expect(
        column.querySelector("[data-sailing-time]")?.classList.contains(color)
      ).toBe(true);
      expect(
        column.querySelector("[data-sailing-chance]")?.textContent
      ).toContain(label);
      expect(
        column.querySelector("[data-sailing-chance]")?.classList.contains(color)
      ).toBe(true);
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
    delete selected.capacity!.projection;
    next.capacity!.state = "already-full";
    next.capacity!.predictedSpacesAtArrival = 0;
    next.capacity!.observedSpacesAtAnchor = 0;
    next.capacity!.fillAt = null;
    next.capacity!.projection = {
      rate: { maximum: 0, minimum: 0, mostLikely: 0 },
      totalSpaces: 100,
    };
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
      columns[1]
        .querySelector("[data-sailing-time]")
        ?.classList.contains("text-gray-dark")
    ).toBe(true);
    expect(
      columns[2]
        .querySelector("[data-sailing-time]")
        ?.classList.contains("text-red-700")
    ).toBe(true);
    expect(
      columns[1]
        .querySelector("[data-sailing-chance]")
        ?.classList.contains("text-gray-dark")
    ).toBe(true);
    expect(
      columns[2]
        .querySelector("[data-sailing-chance]")
        ?.classList.contains("text-red-700")
    ).toBe(true);
    await expandChance("Estimated");
    expect(
      container.querySelector(
        '#sailing-chance-details [data-capacity-index="1"] [data-capacity-area]'
      )
    ).toBeNull();
    await expandChance("Earlier");
    expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(
      1
    );
    expect(container.textContent).not.toContain(
      "Timing alone cannot establish"
    );
  });

  // retain neighboring chance data and locally switch the active buffer
  it("shows three sailings with one always-expanded timing chart", async () => {
    await click("Use my location");
    const buttons = container.querySelectorAll(
      'button[aria-controls="sailing-chance-details"]'
    );
    expect(buttons).toHaveLength(3);
    expect(
      container.querySelector("#sailing-chance-details")?.hasAttribute("hidden")
    ).toBe(false);
    await expandChance("Earlier");
    expect(
      container.querySelector("#sailing-chance-details")?.hasAttribute("hidden")
    ).toBe(false);
    expect(container.textContent).toContain("Planning arrival range");
    expect(container.querySelector("#sailing-chance-details dl")).toBeNull();
    expect(container.textContent).not.toContain("assumed independent");
    await expandChance("Earlier");
    expect(
      container.querySelector("#sailing-chance-details")?.hasAttribute("hidden")
    ).toBe(false);
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
    expect(
      container.querySelector('[aria-label="Sailing estimates"]')?.textContent
    ).not.toContain("100%");
    await input("Safety buffer (minutes)", "25");
    expect(container.textContent).toContain("No later sailing");
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // remove the warning even when the point selector records advisory timing
  it("does not display tight timing and keeps pedestrian details timing-only", async () => {
    schedule.slots[1].time = NOW + 1800;
    await act(async () => {
      root.render(
        <SailingRecommendationCard
          onRefreshSchedule={refreshSchedule}
          schedule={schedule}
        />
      );
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
    expect(container.querySelector("#sailing-chance-details dl")).toBeNull();
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
      root.render(
        <SailingRecommendationCard
          onRefreshSchedule={refreshSchedule}
          schedule={changed}
        />
      );
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
      root.render(
        <SailingRecommendationCard
          onRefreshSchedule={refreshSchedule}
          schedule={schedule}
        />
      );
    });
    await click("Use my location");
    const center = container.querySelector('[aria-label="Sailing estimates"]')
      ?.children[1];
    expect(center?.textContent).toContain("Chosen vessel");
    await expandChance("Estimated");
    expect(container.querySelector("#sailing-chance-details dl")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("[data-capacity-sailing] title"))
        .map((title) => title.textContent)
        .join(" ")
    ).toContain("Chosen vessel");
    await expandChance("Earlier");
    expect(
      container.querySelector(
        'button[aria-label^="Earlier:"] [data-sailing-chance]'
      )?.textContent
    ).toBe("0%");
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

  // retain a bounded live capacity projection for the estimate chart
  it("accepts a normalized capacity projection", async () => {
    const response = makeResponse();
    adapters.post.mockResolvedValue(response);
    const request = {
      arrivingTerminalId: "5",
      bufferMinutes: 5,
      departingTerminalId: "14",
      mode: "drive" as const,
      origin: { address: "Synthetic test origin", kind: "address" as const },
    };

    const result = await getSailingRecommendation(request);
    expect(result.sailingAssessments?.[1].capacity?.projection).toEqual({
      rate: { maximum: 0.75, minimum: 0.25, mostLikely: 0.5 },
      totalSpaces: 100,
    });
  });

  // reject malformed modeled data instead of displaying a fabricated percentage
  it.each([
    {
      name: "an out-of-range joint probability",
      // exceed the probability range
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.probabilities[0] = 2;
      },
    },
    {
      name: "a joint chance above its timing chance",
      // exceed the timing upper bound
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.probabilities[0] = 1;
        value.sailingAssessments![0].chance.timingProbabilities[0] = 0;
      },
    },
    {
      name: "a chance that increases with buffer",
      // violate buffer monotonicity
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.probabilities[1] = 1;
      },
    },
    {
      name: "an undeclared raw route",
      // expose provider route data
      mutate: (value: SailingRecommendationResponse) => {
        Object.assign(value.sailingAssessments![0].chance, { rawRoutes: [] });
      },
    },
    {
      name: "a timing-only basis for driving",
      // contradict the driving chance basis
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![0].chance.basis = "timing-only";
      },
    },
    {
      name: "a cancelled sailing with live details",
      // retain details for an ineligible sailing
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].eligibilityReason = "cancelled";
      },
    },
    {
      name: "missing travel uncertainty",
      // remove the declared uncertainty model
      mutate: (value: SailingRecommendationResponse) => {
        delete value.travelUncertainty;
      },
    },
    {
      name: "null chances with live capacity",
      // discard chances without discarding live capacity
      mutate: (value: SailingRecommendationResponse) => {
        const { chance } = value.sailingAssessments![1];
        chance.probabilities = Array(61).fill(null);
        chance.capacityProbability = null;
        chance.depletionRateRange = null;
        value.sailingAssessments![1].spacesAtArrivalRange = null;
      },
    },
    {
      name: "an outcome sailing outside the snapshot",
      // reference a missing assessment
      mutate: (value: SailingRecommendationResponse) => {
        value.outcome.sailing!.sailingId = "missing-snapshot-id";
      },
    },
    {
      name: "a missing outcome sailing id",
      // remove the normalized sailing identity
      mutate: (value: SailingRecommendationResponse) => {
        delete value.outcome.sailing!.sailingId;
      },
    },
    {
      name: "an unavailable state with live details",
      // retain live claims for unavailable capacity
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].capacity!.state = "unavailable";
      },
    },
    {
      name: "an already-full state with nonzero chance",
      // contradict deterministic fullness
      mutate: (value: SailingRecommendationResponse) => {
        value.sailingAssessments![1].capacity!.state = "already-full";
      },
    },
    {
      name: "an arrival range after the point estimate",
      // invert the travel uncertainty bound
      mutate: (value: SailingRecommendationResponse) => {
        value.travelUncertainty!.earliestArrivalAt = value.arrivalAt! + 1;
      },
    },
    {
      name: "a projection denominator below observed spaces",
      // contradict the live inventory anchor
      mutate: (value: SailingRecommendationResponse) => {
        const capacity = value.sailingAssessments![1].capacity!;
        Object.assign(capacity, {
          projection: {
            rate: { maximum: 1.5, minimum: 0.5, mostLikely: 1 },
            totalSpaces: 29,
          },
        });
      },
    },
    {
      name: "an inverted projection rate range",
      // reverse the depletion bounds
      mutate: (value: SailingRecommendationResponse) => {
        const capacity = value.sailingAssessments![1].capacity!;
        Object.assign(capacity, {
          projection: {
            rate: { maximum: 0.5, minimum: 1.5, mostLikely: 1 },
            totalSpaces: 100,
          },
        });
      },
    },
    {
      name: "non-finite and negative projection rates",
      // reject nonphysical depletion rates
      mutate: (value: SailingRecommendationResponse) => {
        const capacity = value.sailingAssessments![1].capacity!;
        Object.assign(capacity, {
          projection: {
            rate: {
              maximum: Number.POSITIVE_INFINITY,
              minimum: -1,
              mostLikely: 1,
            },
            totalSpaces: 100,
          },
        });
      },
    },
    {
      name: "a projection without a live anchor",
      // remove the projection intercept
      mutate: (value: SailingRecommendationResponse) => {
        const capacity = value.sailingAssessments![1].capacity!;
        Object.assign(capacity, {
          anchorAt: null,
          projection: {
            rate: { maximum: 1.5, minimum: 0.5, mostLikely: 1 },
            totalSpaces: 100,
          },
        });
      },
    },
  ])("rejects $name", async ({ mutate }) => {
    const trip = {
      arrivingTerminalId: "5",
      departingTerminalId: "14",
      bufferMinutes: 5,
      mode: "drive" as const,
      origin: { kind: "address" as const, address: "Synthetic test origin" },
    };
    const value = makeResponse();
    mutate(value);
    adapters.post.mockResolvedValue(value);
    await expect(getSailingRecommendation(trip)).rejects.toThrow(
      "Sailing estimate unavailable"
    );
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
