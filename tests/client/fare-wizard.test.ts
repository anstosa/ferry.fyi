import { describe, expect, it } from "vitest";

import {
  createFareWizardSelections,
  parseFareWizardConfig,
  withFareWizardConfig,
} from "../../client/lib/fareWizard";

const fares = [
  { id: 1, label: "Adult (age 19 - 64)" },
  { id: 2, label: "Youth (age 18 and under)" },
  { id: 3, label: "Senior (age 65 & over)" },
  { id: 4, label: "Vehicle Under 22' (standard veh) & Driver" },
  { id: 5, label: "Vehicle U22' & Sr/Disability Driver" },
  { id: 6, label: "Vehicle Under 80'" },
  { id: 7, label: "Cost per foot over 80'" },
] as never;

describe("fare wizard", () => {
  it("round-trips a fare configuration without losing route query values", () => {
    const config = parseFareWizardConfig(
      "?date=2026-07-19&fareMode=vehicle&fareDriver=senior&fareVehicle=standard&fareLength=35&fareAdults=2&fareChildren=1&fareSeniors=3"
    );

    expect(config).toMatchObject({
      adultPassengers: 2,
      childPassengers: 1,
      isSeniorOrDisabledDriver: true,
      seniorPassengers: 3,
      vehicleLength: 35,
      vehicleType: "standard",
    });
    expect(withFareWizardConfig("?date=2026-07-19", config)).toContain(
      "date=2026-07-19"
    );
  });

  it("creates official selections for the driver and additional passengers", () => {
    expect(
      createFareWizardSelections(fares, {
        adultPassengers: 2,
        childPassengers: 1,
        isSeniorOrDisabledDriver: true,
        seniorPassengers: 3,
        travelMode: "vehicle",
        vehicleLength: 30,
        vehicleType: "standard",
      })
    ).toEqual({
      lineItems: [
        { fareLineItemId: 5, quantity: 1 },
        { fareLineItemId: 1, quantity: 2 },
        { fareLineItemId: 2, quantity: 1 },
        { fareLineItemId: 3, quantity: 3 },
      ],
      ok: true,
    });
  });

  it("adds the per-foot fare for vehicles longer than 80 feet", () => {
    expect(
      createFareWizardSelections(fares, {
        adultPassengers: 0,
        childPassengers: 0,
        isSeniorOrDisabledDriver: false,
        seniorPassengers: 0,
        travelMode: "vehicle",
        vehicleLength: 90,
        vehicleType: "tall-or-long",
      })
    ).toEqual({
      lineItems: [
        { fareLineItemId: 6, quantity: 1 },
        { fareLineItemId: 7, quantity: 10 },
      ],
      ok: true,
    });
  });
});
