// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Slot } from "shared/contracts/schedules";
import { describe, expect, it } from "vitest";

import { CompactSailingSummary } from "../../client/components/CompactSailingSummary";
import { createForecastSlot } from "../fixtures/forecastSlot";

// build one compact sailing fixture
const createSlot = (
  crossing: Slot["crossing"] | null = {
    arrivalId: "14",
    departureDelta: 300,
    departureId: "5",
    departureTime: 1_782_088_690,
    driveUpCapacity: 25,
    hasDriveUp: true,
    hasReservations: true,
    isCancelled: false,
    reservableCapacity: 0,
    totalCapacity: 100,
  }
): Slot => ({
  ...createForecastSlot({
    fullRisk: "high",
    spacesLeft: 1,
  }),
  crossing: crossing ?? undefined,
  hasPassed: true,
  time: 1_782_088_200,
});

// render one summary
const renderSummary = (slot: Slot, isDaylight = true): HTMLElement => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <CompactSailingSummary isDaylight={isDaylight} slot={slot} />
  );
  return container;
};

describe("compact sailing summary", () => {
  // confirmed content
  it("shows scheduled Pacific time, confirmed delay, and confirmed fullness", () => {
    const container = renderSummary(createSlot());

    expect(container.textContent).toContain("5:30 PM");
    expect(container.textContent).not.toContain("05:30");
    expect(container.textContent).toContain("5 min late");
    expect(container.textContent).not.toContain("Test Vessel");
    expect(
      container.querySelector('[aria-label="Confirmed capacity: 75% full"]')
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>("[data-confirmed-capacity-fill]")
        ?.style.width
    ).toBe("75%");
    expect(
      container
        .querySelector("[data-confirmed-capacity-fill]")
        ?.classList.contains("bg-day-confirmed-light")
    ).toBe(true);
    expect(
      container
        .querySelector("[data-confirmed-capacity-fill]")
        ?.classList.contains("opacity-50")
    ).toBe(true);
  });

  // full crossing
  it("uses the confirmed full-capacity stripes in the correct daylight context", () => {
    const baseCrossing = createSlot().crossing!;
    const slot = createSlot({
      ...baseCrossing,
      driveUpCapacity: 4,
      reservableCapacity: 0,
      totalCapacity: 100,
    });
    const day = renderSummary(slot);
    const night = renderSummary(slot, false);

    expect(
      day
        .querySelector("[data-confirmed-capacity-fill]")
        ?.classList.contains("bg-full-day")
    ).toBe(true);
    expect(
      night
        .querySelector("[data-confirmed-capacity-fill]")
        ?.classList.contains("bg-full-night")
    ).toBe(true);
  });

  // share the full-card rounded-minute on-time window and delay colors
  it.each([
    { departureDelta: 210, expected: "4 min late", color: "text-late-light" },
    { departureDelta: 300, expected: "5 min late", color: "text-late-light" },
    {
      departureDelta: -211,
      expected: "4 min early",
      color: "text-yellow-dark",
    },
    {
      departureDelta: -300,
      expected: "5 min early",
      color: "text-yellow-dark",
    },
  ])(
    "formats and colors $departureDelta-second confirmed timing",
    ({ departureDelta, expected, color }) => {
      const container = renderSummary(
        createSlot({ ...createSlot().crossing!, departureDelta })
      );
      const status = container.querySelector<HTMLElement>(
        '[title="Confirmed departure timing"]'
      )!;
      expect(status.textContent).toBe(expected);
      expect(status.classList).toContain(color);
      expect(status.classList).toContain(
        departureDelta > 0 ? "dark:text-late-dark" : "dark:text-yellow-medium"
      );
      const time = container.querySelector("time")!;
      expect(
        status.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(container.lastElementChild).toBe(time);
      expect(time.previousElementSibling?.classList).toContain("flex-1");
    }
  );

  // sub-threshold and malformed timing remains hidden rather than noisy or invented
  it.each([
    0,
    59,
    61,
    90,
    180,
    209,
    -30,
    -60,
    -180,
    -210,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("omits non-reportable confirmed timing %s", (departureDelta) => {
    const container = renderSummary(
      createSlot({ ...createSlot().crossing!, departureDelta })
    );
    expect(container.textContent).not.toMatch(/\b(?:sec|min) (?:late|early)\b/);
    expect(
      container.querySelector('[title="Confirmed departure timing"]')
    ).toBeNull();
    expect(container.textContent).toContain("5:30 PM");
  });

  // cancellation precedence
  it("shows cancellation instead of confirmed capacity or timing", () => {
    const baseCrossing = createSlot().crossing!;
    const container = renderSummary(
      createSlot({ ...baseCrossing, isCancelled: true })
    );

    expect(container.textContent).toContain("Cancelled");
    expect(container.textContent).not.toContain("min late");
    expect(
      container.querySelector("[data-confirmed-capacity-fill]")
    ).toBeNull();
  });

  // forecast exclusion
  it("does not render forecast fullness as confirmed background", () => {
    const container = renderSummary(createSlot(null));

    expect(
      container.querySelector("[data-confirmed-capacity-fill]")
    ).toBeNull();
    expect(container.textContent).not.toContain("Confirmed capacity");
  });

  // invalid confirmed capacity
  it.each([
    { driveUpCapacity: 100, reservableCapacity: 0 },
    { driveUpCapacity: 101, reservableCapacity: 0 },
    { driveUpCapacity: -1, reservableCapacity: 0 },
    { driveUpCapacity: 25, reservableCapacity: -1 },
    { driveUpCapacity: 25, reservableCapacity: Number.NaN },
    { driveUpCapacity: 25, reservableCapacity: 0, hasDriveUp: false },
  ])("omits unverified or invalid provider capacity %j", (capacity) => {
    const container = renderSummary(
      createSlot({ ...createSlot().crossing!, ...capacity })
    );

    expect(
      container.querySelector("[data-confirmed-capacity-fill]")
    ).toBeNull();
    expect(container.textContent).not.toContain("Confirmed capacity");
    expect(container.textContent).toContain("5 min late");
  });

  // unoffered reservation inventory does not hide confirmed drive-up reports
  it("retains confirmed drive-up fullness when reservations are not offered", () => {
    const container = renderSummary(
      createSlot({
        ...createSlot().crossing!,
        hasReservations: false,
        reservableCapacity: null as unknown as number,
      })
    );

    expect(
      container.querySelector<HTMLElement>("[data-confirmed-capacity-fill]")
        ?.style.width
    ).toBe("75%");
    expect(container.textContent).toContain("Confirmed capacity: 75% full");
  });

  // unknown reservation inventory must not become zero on reservation routes
  it("omits fullness when offered reservation inventory is unknown", () => {
    const container = renderSummary(
      createSlot({
        ...createSlot().crossing!,
        hasReservations: true,
        reservableCapacity: null as unknown as number,
      })
    );

    expect(
      container.querySelector("[data-confirmed-capacity-fill]")
    ).toBeNull();
  });

  // invalid total
  it("omits invalid confirmed capacity", () => {
    const baseCrossing = createSlot().crossing!;
    const container = renderSummary(
      createSlot({ ...baseCrossing, totalCapacity: 0 })
    );

    expect(
      container.querySelector("[data-confirmed-capacity-fill]")
    ).toBeNull();
    expect(container.textContent).not.toContain("Confirmed capacity");
  });
});
