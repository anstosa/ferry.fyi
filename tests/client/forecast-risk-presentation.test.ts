import { describe, expect, it } from "vitest";

import {
  formatForecast,
  getForecastRiskPresentation,
  isForecastExpectedFull,
} from "../../client/views/Schedule/forecastRiskPresentation";

describe("forecast risk presentation", () => {
  // practical-full warning
  it.each([
    [0.46, "unlikely", "likely"],
    [0.34, "unlikely", "likely"],
  ] as const)(
    "shows near capacity at %s probability with %s calibrated risk",
    (fullProbability, fullRisk, tone) => {
      expect(
        getForecastRiskPresentation({
          fullProbability,
          fullRisk,
          isPracticalFull: true,
        })
      ).toEqual({
        compactText: `Near capacity · ${Math.round(
          fullProbability * 100
        )}% full risk`,
        detail: `${Math.round(
          fullProbability * 100
        )}% chance of filling completely`,
        heading: "Capacity warning",
        label: "Near capacity",
        tone,
      });
    }
  );

  // expected-full categories
  it.each([
    ["likely", true],
    ["high", true],
    ["unlikely", false],
    ["low", false],
    [undefined, false],
  ] as const)("classifies %s full risk as expected full: %s", (risk, result) => {
    expect(isForecastExpectedFull(risk)).toBe(result);
  });

  // expected-full risk copy
  it.each([
    [0.6, "likely", "Likely full · 60% full risk", "likely"],
    [0.84, "high", "High full risk · 84% full risk", "high"],
  ] as const)(
    "preserves %s probability with %s expected-full risk",
    (fullProbability, fullRisk, compactText, tone) => {
      expect(
        getForecastRiskPresentation({
          fullProbability,
          fullRisk,
          isPracticalFull: true,
        })
      ).toEqual({
        compactText,
        detail: `${Math.round(fullProbability * 100)}% likelihood`,
        heading: "Full sailing risk",
        label: fullRisk,
        tone,
      });
    }
  );

  // probability-derived copy
  it("preserves calibrated risk copy outside practical-full forecasts", () => {
    expect(
      getForecastRiskPresentation({
        fullProbability: 0.46,
        fullRisk: "unlikely",
        isPracticalFull: false,
      })
    ).toEqual({
      compactText: "Unlikely full · 46% full risk",
      detail: "46% likelihood",
      heading: "Full sailing risk",
      label: "unlikely",
      tone: "unlikely",
    });
  });

  // public forecast copy
  it("formats practical and expected-full forecast copy", () => {
    const practicalFullForecast = formatForecast(
      {
        driveUpCapacity: 3,
        fullProbability: 0.46,
        fullRisk: "unlikely",
        reservableCapacity: 0,
      },
      141
    );
    expect(practicalFullForecast).toContain(
      "forecast full, Near capacity · 46% full risk"
    );
    expect(practicalFullForecast).not.toContain("3 vehicle spaces");
    expect(
      formatForecast(
        {
          driveUpCapacity: 12,
          fullProbability: 0.46,
          fullRisk: "unlikely",
          reservableCapacity: 0,
        },
        120
      )
    ).toContain("Unlikely full · 46% full risk");
    const likelyFullForecast = formatForecast(
      {
        driveUpCapacity: 20,
        fullProbability: 0.6,
        fullRisk: "likely",
        reservableCapacity: 0,
      },
      120
    );
    expect(likelyFullForecast).toContain(
      "forecast full, Likely full · 60% full risk"
    );
    expect(likelyFullForecast).not.toContain("20 vehicle spaces");
  });
});
