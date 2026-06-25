import { describe, expect, it } from "vitest";

import cameras from "../../shared/data/cameras.json";
import wsfCore from "../../shared/data/wsf-core.json";

// metadata contract
describe("camera metadata", () => {
  // all cameras covered
  it("has an explicit metadata row for every core camera", () => {
    const cameraIds = Object.keys(wsfCore.cameras).sort();
    const metadataIds = Object.keys(cameras).sort();

    expect(metadataIds).toEqual(cameraIds);
  });

  // direct car-count shape
  it("uses direct car count values instead of segment metadata", () => {
    Object.entries(cameras).forEach(([id, camera]) => {
      // old metadata guard
      expect(camera).not.toHaveProperty("feetToNext");
      expect(camera).not.toHaveProperty("spacesToNext");
      expect(camera).toHaveProperty("carCapacity");
      expect(camera).toHaveProperty("carsToBoat");

      const { carCapacity, carsToBoat } = camera;
      // nullable capacity guard
      expect(
        typeof carCapacity === "number" || carCapacity === null,
        `${id} must have a number or null carCapacity estimate`
      ).toBe(true);
      // nullable estimate guard
      expect(
        typeof carsToBoat === "number" || carsToBoat === null,
        `${id} must have a number or null carsToBoat estimate`
      ).toBe(true);
    });
  });

  // holding camera capacity rule
  it("shows terminal capacities only on holding cameras", () => {
    Object.entries(cameras).forEach(([id, camera]) => {
      const isHoldingCamera = camera.title.includes("Holding");
      // holding camera guard
      if (isHoldingCamera) {
        expect(
          camera.carCapacity,
          `${id} holding camera must show car capacity`
        ).toBeGreaterThan(0);
        expect(camera.carsToBoat).toBeNull();
        return;
      }
      expect(camera.carCapacity).toBeNull();
    });
  });

  // estimate regression samples
  it("keeps representative capacity, queue, and null decisions", () => {
    expect(cameras["9048"].carCapacity).toBe(450);
    expect(cameras["9048"].carsToBoat).toBeNull();
    expect(cameras["9741"].carCapacity).toBe(50);
    expect(cameras["9741"].carsToBoat).toBeNull();
    expect(cameras["9944"].carCapacity).toBeNull();
    expect(cameras["9944"].carsToBoat).toBe(257);
    expect(cameras["10266"].carsToBoat).toBe(427);
    expect(cameras["9047"].carCapacity).toBeNull();
    expect(cameras["9047"].carsToBoat).toBeNull();
  });

  interface CameraOrderCase {
    ids: Array<keyof typeof cameras>;
    orders: number[];
    terminalName: string;
    titles: string[];
  }

  const cameraOrderCases: CameraOrderCase[] = [
    {
      terminalName: "Anacortes",
      ids: ["9047", "9048", "9049"],
      titles: ["Dock", "Holding", "Tollbooth (facing away)"],
      orders: [0, 1, 2],
    },
    {
      terminalName: "Bainbridge",
      ids: ["9040", "9476", "9477", "9479", "9478"],
      titles: [
        "Holding",
        "Winslow Way (facing towards)",
        "Winslow Way (facing away)",
        "High School (facing towards)",
        "High School (facing away)",
      ],
      orders: [1, 2, 3, 4, 5],
    },
    {
      terminalName: "Clinton",
      ids: ["9173", "9166", "9172", "9174", "9175"],
      titles: [
        "Dock",
        "Holding",
        "Tollbooth (facing away)",
        "Food Mart (facing towards)",
        "Post Office (facing away)",
      ],
      orders: [0, 1, 2, 3, 4],
    },
    {
      terminalName: "Coupeville",
      ids: ["9169", "9170"],
      titles: ["Holding", "Tollbooth (facing away)"],
      orders: [1, 2],
    },
    {
      terminalName: "Edmonds",
      ids: ["9157", "9155", "9160", "9159", "9156"],
      titles: [
        "Holding",
        "Dayton Street (facing away)",
        "Pine Street (facing towards)",
        "Pine Street (facing away)",
        "100th Ave (facing towards)",
      ],
      orders: [1, 2, 3, 4, 5],
    },
    {
      terminalName: "Fauntleroy",
      ids: ["9038", "9402", "9403", "9377", "9404"],
      titles: [
        "Holding",
        "Tollbooth (facing away)",
        "Trenton Street (facing away)",
        "Playground (facing away)",
        "Lincoln Park (facing away)",
      ],
      orders: [1, 2, 3, 4, 5],
    },
    {
      terminalName: "Friday Harbor",
      ids: ["1233", "9502"],
      titles: ["Main Holding", "Overflow Holding"],
      orders: [1, 2],
    },
    {
      terminalName: "Kingston",
      ids: ["9151", "9813", "10266", "9154", "9153", "9152"],
      titles: [
        "Holding",
        "Tollbooth (facing away)",
        "Downtown (facing away)",
        "Barber Cut Off Road (facing towards)",
        "Fir Hollow Drive (facing away)",
        "Ferry Sign East",
      ],
      orders: [1, 2, 3, 4, 5, 6],
    },
    {
      terminalName: "Lopez",
      ids: ["10113", "10112", "9693", "9692"],
      titles: [
        "Front Holding (facing towards)",
        "Holding",
        "Back Holding (facing away)",
        "Tollbooth (facing away)",
      ],
      orders: [1, 2, 3, 4],
    },
    {
      terminalName: "Mukilteo",
      ids: ["9164", "9944", "9394", "9728", "9161", "9162", "9163"],
      titles: [
        "Holding",
        "Tollbooth (facing towards)",
        "5th Street (facing towards)",
        "5th Street (facing away)",
        "Clover Lane (facing towards)",
        "School (facing towards)",
        "School (facing away)",
      ],
      orders: [1, 2, 3, 4, 5, 6, 7],
    },
    {
      terminalName: "Orcas",
      ids: ["9688", "9689"],
      titles: ["Holding", "Tollbooth (facing away)"],
      orders: [1, 2],
    },
    {
      terminalName: "Point Defiance",
      ids: ["9741", "9742"],
      titles: ["Holding", "Tollbooth (facing away)"],
      orders: [1, 2],
    },
    {
      terminalName: "Port Townsend",
      ids: ["9167", "9168"],
      titles: ["Holding", "Tollbooth (facing away)"],
      orders: [1, 2],
    },
    {
      terminalName: "Southworth",
      ids: ["9039", "9391"],
      titles: ["Dock (facing away)", "Holding"],
      orders: [0, 1],
    },
    {
      terminalName: "Tahlequah",
      ids: ["9045", "9046"],
      titles: ["Holding", "Tollbooth (facing away)"],
      orders: [1, 2],
    },
    {
      terminalName: "Vashon",
      ids: ["9717", "9041", "9042", "9043", "9044"],
      titles: [
        "Holding (facing away)",
        "Bunker Trail (facing towards)",
        "Bunker Trail (facing away)",
        "112th Street (facing towards)",
        "112th Street (facing away)",
      ],
      orders: [1, 2, 3, 4, 5],
    },
  ];

  // resolve metadata rows
  const getCameraRows = (ids: CameraOrderCase["ids"]) =>
    ids.map((id) => {
      // resolve metadata row
      return cameras[id];
    });

  // display order overrides
  it.each(cameraOrderCases)(
    "keeps $terminalName cameras in requested queue order",
    ({ ids, orders, titles }) => {
      const terminalCameras = getCameraRows(ids);

      expect(
        terminalCameras.map(({ title }) => {
          // expose display title
          return title;
        })
      ).toEqual(titles);
      expect(
        terminalCameras.map(({ orderFromTerminal }) => {
          // expose display order
          return orderFromTerminal;
        })
      ).toEqual(orders);
    }
  );

});
