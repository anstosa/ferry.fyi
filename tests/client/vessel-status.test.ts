import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { describe, expect, it } from "vitest";

import {
  formatDelaySeconds,
  getDelayCardModel,
  getForecastLateText,
  getRoundedEtaMinutes,
  isAfterCurrentSlot,
  roundStatusNumber,
} from "../../client/views/Schedule/vesselStatus";

// vessel status formatting
describe("vessel status formatting", () => {
  // eta rounding
  it("rounds ETA minutes to the nearest whole number", () => {
    const time = DateTime.fromISO("2026-06-24T12:00:00", {
      zone: "America/Los_Angeles",
    });

    expect(
      getRoundedEtaMinutes(time.plus({ minutes: 22.6 }).toSeconds(), time)
    ).toBe(23);
  });

  // status number rounding
  it("rounds status numbers to whole numbers", () => {
    expect(roundStatusNumber(12.49)).toBe(12);
    expect(roundStatusNumber(12.5)).toBe(13);
  });

  // delay signal labels
  it("formats delay signals for expanded cards", () => {
    expect(formatDelaySeconds(12 * 60)).toBe("12 mins late");
    expect(formatDelaySeconds(-60)).toBe("1 min ahead");
    expect(formatDelaySeconds(null)).toBe("Unavailable");
  });

  // GPS delay card
  it("builds an expanded delay card with GPS and supporting signals", () => {
    const slot = {
      arrivalTime: 2000,
      crossing: { departureDelta: 3 * 60 },
      time: 1000,
      vessel: {
        departureDelta: 4 * 60,
        gpsDelay: {
          confidence: "high",
          delaySeconds: 12 * 60,
          explanation: "GPS explanation",
          signals: {
            dockDelaySeconds: 8 * 60,
            etaDelaySeconds: 5 * 60,
            progress: 0.5,
            scheduledArrivalTime: 2000,
            scheduledDepartureTime: 1000,
          },
          source: "gps",
        },
      },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 12, slot });

    expect(card.title).toBe("Projected 12 mins late");
    expect(card.isLate).toBe(true);
    expect(card.isProjected).toBe(true);
    expect(card.signals.map(({ label }) => label)).toEqual([
      "Schedule",
      "GPS Reports",
      "Terminal Reports",
      "Vessel Reports",
    ]);
    expect(card.signals[1].value).toBe("12 mins late");
    expect(card.signals[2].value).toBe("8 mins late");
    expect(card.signals[3].value).toBe("4 mins late");
  });

  // future on-time GPS delay card
  it("labels future on-time GPS delay cards as projected", () => {
    const slot = {
      arrivalTime: 2000,
      time: 1000,
      vessel: {
        gpsDelay: {
          confidence: "high",
          delaySeconds: 0,
          explanation: "GPS explanation",
          signals: {
            dockDelaySeconds: 0,
            etaDelaySeconds: 0,
            progress: 0.5,
            scheduledArrivalTime: 2000,
            scheduledDepartureTime: 1000,
          },
          source: "gps",
        },
      },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 0, slot });

    expect(card.title).toBe("Projected on time");
    expect(card.isLate).toBe(false);
    expect(card.isProjected).toBe(true);
  });

  // small GPS delay summary
  it("counts GPS delays up to three minutes as on time in summaries", () => {
    const slot = {
      arrivalTime: 2000,
      crossing: { departureDelta: 3 * 60 },
      time: 1000,
      vessel: {
        departureDelta: 3 * 60 + 20,
        gpsDelay: {
          confidence: "high",
          delaySeconds: 3 * 60 + 20,
          explanation: "GPS explanation",
          signals: {
            dockDelaySeconds: 3 * 60 + 20,
            etaDelaySeconds: 3 * 60 + 20,
            progress: 0.5,
            scheduledArrivalTime: 2000,
            scheduledDepartureTime: 1000,
          },
          source: "gps",
        },
      },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 3, slot });

    expect(card.title).toBe("Projected on time");
    expect(card.isLate).toBe(false);
    expect(card.signals.find(({ label }) => label === "GPS Reports")?.value).toBe(
      "3 mins late"
    );
  });

  // non-matching GPS delay card
  it("uses fallback card details when vessel GPS belongs to another slot", () => {
    const slot = {
      crossing: { departureDelta: 7 * 60 },
      time: 1000,
      arrivalTime: 2000,
      vessel: {
        departureDelta: 6 * 60,
        estimatedArrivalTime: 2000 + 9 * 60,
        gpsDelay: {
          confidence: "high",
          delaySeconds: 12 * 60,
          explanation: "GPS explanation",
          signals: {
            dockDelaySeconds: 8 * 60,
            etaDelaySeconds: 5 * 60,
            progress: 0.5,
            scheduledArrivalTime: 3000,
            scheduledDepartureTime: 2000,
          },
          source: "gps",
        },
      },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 7, slot });

    expect(card.title).toBe("Projected 7 mins late");
    expect(card.isProjected).toBe(true);
    expect(card.signals.map(({ label }) => label)).toEqual([
      "Schedule",
      "GPS Reports",
      "Terminal Reports",
      "Vessel Reports",
    ]);
    expect(card.signals.find(({ label }) => label === "GPS Reports")?.value).toBe(
      "7 mins late"
    );
  });

  // past GPS delay card
  it("omits GPS prefix on past GPS delay cards", () => {
    const slot = {
      arrivalTime: 2000,
      hasPassed: true,
      time: 1000,
      vessel: {
        gpsDelay: {
          confidence: "high",
          delaySeconds: 12 * 60,
          explanation: "GPS explanation",
          signals: {
            dockDelaySeconds: 8 * 60,
            etaDelaySeconds: 5 * 60,
            progress: 0.5,
            scheduledArrivalTime: 2000,
            scheduledDepartureTime: 1000,
          },
          source: "gps",
        },
      },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 12, slot });

    expect(card.title).toBe("12 mins late");
    expect(card.isConfirmed).toBe(true);
    expect(card.isProjected).toBe(false);
  });

  // past fallback delay card
  it("omits projected wording on past fallback delay cards", () => {
    const slot = {
      arrivalTime: 2000,
      crossing: { departureDelta: 7 * 60 },
      hasPassed: true,
      time: 1000,
      vessel: { departureDelta: 6 * 60 },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 7, slot });

    expect(card.title).toBe("7 mins late");
    expect(card.isConfirmed).toBe(true);
    expect(card.isProjected).toBe(false);
  });

  // fallback delay card
  it("builds a fallback delay card when GPS is unavailable", () => {
    const slot = {
      crossing: { departureDelta: 7 * 60 },
      arrivalTime: 2000,
      time: 1000,
      vessel: {
        departureDelta: 6 * 60,
        estimatedArrivalTime: 2000 + 9 * 60,
      },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 7, slot });

    expect(card.title).toBe("Projected 7 mins late");
    expect(card.isLate).toBe(true);
    expect(card.isProjected).toBe(true);
    expect(card.signals.find(({ label }) => label === "GPS Reports")?.value).toBe(
      "7 mins late"
    );
    expect(
      card.signals.find(({ label }) => label === "Terminal Reports")?.value
    ).toBe("7 mins late");
    expect(
      card.signals.find(({ label }) => label === "Vessel Reports")?.value
    ).toBe("6 mins late");
  });

  // small fallback delay summary
  it("counts fallback delays up to three minutes as on time in summaries", () => {
    const slot = {
      crossing: { departureDelta: 3 * 60 },
      arrivalTime: 2000,
      time: 1000,
      vessel: {
        departureDelta: 3 * 60,
        estimatedArrivalTime: 2000 + 3 * 60,
      },
    } as Slot;

    const card = getDelayCardModel({ delayMins: 3, slot });

    expect(card.title).toBe("Projected on time");
    expect(card.isLate).toBe(false);
    expect(
      card.signals.find(({ label }) => label === "Terminal Reports")?.value
    ).toBe("3 mins late");
  });

  // past on-time delay card
  it("uses bare on-time text for past delay cards", () => {
    const slot = {
      arrivalTime: 2000,
      hasPassed: true,
      time: 1000,
      vessel: {},
    } as Slot;

    const card = getDelayCardModel({ delayMins: 0, slot });

    expect(card.title).toBe("On time");
    expect(card.isLate).toBe(false);
    expect(card.isProjected).toBe(false);
  });

  // future delay label
  it("labels future vessel delays as forecasts", () => {
    expect(getForecastLateText(12.5)).toBe("Forecast 13 mins late");
    expect(getForecastLateText(4)).toBe("Forecast 4 mins late");
    expect(getForecastLateText(3.4)).toBeNull();
    expect(getForecastLateText(3)).toBeNull();
    expect(getForecastLateText(0)).toBeNull();
  });

  // future slot check
  it("identifies sailings after the current one", () => {
    const slots = [{ time: 1000 }, { time: 2000 }, { time: 3000 }] as Slot[];

    expect(
      isAfterCurrentSlot({
        currentSlot: slots[1],
        schedule: slots,
        slot: slots[2],
      })
    ).toBe(true);
    expect(
      isAfterCurrentSlot({
        currentSlot: slots[1],
        schedule: slots,
        slot: slots[1],
      })
    ).toBe(false);
  });
});
