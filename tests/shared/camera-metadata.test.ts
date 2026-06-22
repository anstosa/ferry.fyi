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

  // direct cars-to-boat shape
  it("uses direct carsToBoat values instead of segment metadata", () => {
    Object.entries(cameras).forEach(([id, camera]) => {
      // old metadata guard
      expect(camera).not.toHaveProperty("feetToNext");
      expect(camera).not.toHaveProperty("spacesToNext");
      expect(camera).toHaveProperty("carsToBoat");

      const { carsToBoat } = camera;
      // nullable estimate guard
      expect(
        typeof carsToBoat === "number" || carsToBoat === null,
        `${id} must have a number or null carsToBoat estimate`
      ).toBe(true);
    });
  });

  // estimate regression samples
  it("keeps representative map-derived estimates and null decisions", () => {
    expect(cameras["9944"].carsToBoat).toBe(153);
    expect(cameras["10266"].carsToBoat).toBe(173);
    expect(cameras["9047"].carsToBoat).toBeNull();
  });

  // anacortes display overrides
  it("keeps Anacortes cameras in dock-first queue order", () => {
    const anacortesCameraIds = ["9047", "9048", "9049"];
    const anacortesCameras = anacortesCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      anacortesCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Dock", "Holding", "Tollbooth (facing away)"]);
    expect(
      anacortesCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([0, 1, 2]);
  });

  // bainbridge display overrides
  it("keeps Bainbridge cameras in requested queue order", () => {
    const bainbridgeCameraIds = ["9040", "9476", "9477", "9479", "9478"];
    const bainbridgeCameras = bainbridgeCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      bainbridgeCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Holding",
      "Winslow Way (facing towards)",
      "Winslow Way (facing away)",
      "High School (facing towards)",
      "High School (facing away)",
    ]);
    expect(
      bainbridgeCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2, 3, 4, 5]);
  });

  // clinton display overrides
  it("keeps Clinton cameras in dock-first queue order", () => {
    const clintonCameraIds = ["9173", "9166", "9172", "9174", "9175"];
    const clintonCameras = clintonCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      clintonCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Dock",
      "Holding",
      "Tollbooth (facing away)",
      "Food Mart (facing towards)",
      "Post Office (facing away)",
    ]);
    expect(
      clintonCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([0, 1, 2, 3, 4]);
  });

  // coupeville display overrides
  it("keeps Coupeville cameras in requested queue order", () => {
    const coupevilleCameraIds = ["9169", "9170"];
    const coupevilleCameras = coupevilleCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      coupevilleCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Holding", "Tollbooth (facing away)"]);
    expect(
      coupevilleCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2]);
  });

  // edmonds display overrides
  it("keeps Edmonds cameras in requested queue order", () => {
    const edmondsCameraIds = ["9157", "9155", "9160", "9159", "9156"];
    const edmondsCameras = edmondsCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      edmondsCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Holding",
      "Dayton Street (facing away)",
      "Pine Street (facing towards)",
      "Pine Street (facing away)",
      "100th Ave (facing towards)",
    ]);
    expect(
      edmondsCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2, 3, 4, 5]);
  });

  // fauntleroy display overrides
  it("keeps Fauntleroy cameras in requested queue order", () => {
    const fauntleroyCameraIds = ["9038", "9402", "9403", "9377", "9404"];
    const fauntleroyCameras = fauntleroyCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      fauntleroyCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Holding",
      "Tollbooth (facing away)",
      "Trenton Street (facing away)",
      "Playground (facing away)",
      "Lincoln Park (facing away)",
    ]);
    expect(
      fauntleroyCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2, 3, 4, 5]);
  });

  // friday harbor display overrides
  it("keeps Friday Harbor cameras in requested queue order", () => {
    const fridayHarborCameraIds = ["1233", "9502"];
    const fridayHarborCameras = fridayHarborCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      fridayHarborCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Main Holding", "Overflow Holding"]);
    expect(
      fridayHarborCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2]);
  });

  // kingston display overrides
  it("keeps Kingston cameras in requested queue order", () => {
    const kingstonCameraIds = ["9151", "9813", "10266", "9154", "9153", "9152"];
    const kingstonCameras = kingstonCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      kingstonCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Holding",
      "Tollbooth (facing away)",
      "Downtown (facing away)",
      "Barber Cut Off Road (facing towards)",
      "Fir Hollow Drive (facing away)",
      "Ferry Sign East",
    ]);
    expect(
      kingstonCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  // lopez display overrides
  it("keeps Lopez cameras in requested queue order", () => {
    const lopezCameraIds = ["10113", "10112", "9693", "9692"];
    const lopezCameras = lopezCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      lopezCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Front Holding (facing towards)",
      "Holding",
      "Back Holding (facing away)",
      "Tollbooth (facing away)",
    ]);
    expect(
      lopezCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2, 3, 4]);
  });

  // mukilteo display overrides
  it("keeps Mukilteo cameras in requested queue order", () => {
    const mukilteoCameraIds = [
      "9164",
      "9944",
      "9394",
      "9728",
      "9161",
      "9162",
      "9163",
    ];
    const mukilteoCameras = mukilteoCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      mukilteoCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Holding",
      "Tollbooth (facing towards)",
      "5th Street (facing towards)",
      "5th Street (facing away)",
      "Clover Lane (facing towards)",
      "School (facing towards)",
      "School (facing away)",
    ]);
    expect(
      mukilteoCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  // orcas display overrides
  it("keeps Orcas cameras in requested queue order", () => {
    const orcasCameraIds = ["9688", "9689"];
    const orcasCameras = orcasCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      orcasCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Holding", "Tollbooth (facing away)"]);
    expect(
      orcasCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2]);
  });

  // point defiance display overrides
  it("keeps Point Defiance cameras in requested queue order", () => {
    const pointDefianceCameraIds = ["9741", "9742"];
    const pointDefianceCameras = pointDefianceCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      pointDefianceCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Holding", "Tollbooth (facing away)"]);
    expect(
      pointDefianceCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2]);
  });

  // port townsend display overrides
  it("keeps Port Townsend cameras in requested queue order", () => {
    const portTownsendCameraIds = ["9167", "9168"];
    const portTownsendCameras = portTownsendCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      portTownsendCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Holding", "Tollbooth (facing away)"]);
    expect(
      portTownsendCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2]);
  });

  // southworth display overrides
  it("keeps Southworth cameras in dock-first queue order", () => {
    const southworthCameraIds = ["9039", "9391"];
    const southworthCameras = southworthCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      southworthCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Dock (facing away)", "Holding"]);
    expect(
      southworthCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([0, 1]);
  });

  // tahlequah display overrides
  it("keeps Tahlequah cameras in requested queue order", () => {
    const tahlequahCameraIds = ["9045", "9046"];
    const tahlequahCameras = tahlequahCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      tahlequahCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual(["Holding", "Tollbooth (facing away)"]);
    expect(
      tahlequahCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2]);
  });

  // vashon display overrides
  it("keeps Vashon cameras in requested queue order", () => {
    const vashonCameraIds = ["9717", "9041", "9042", "9043", "9044"];
    const vashonCameras = vashonCameraIds.map((id) => {
      // resolve metadata row
      return cameras[id as keyof typeof cameras];
    });

    expect(
      vashonCameras.map(({ title }) => {
        // expose display title
        return title;
      })
    ).toEqual([
      "Holding (facing away)",
      "Bunker Trail (facing towards)",
      "Bunker Trail (facing away)",
      "112th Street (facing towards)",
      "112th Street (facing away)",
    ]);
    expect(
      vashonCameras.map(({ orderFromTerminal }) => {
        // expose display order
        return orderFromTerminal;
      })
    ).toEqual([1, 2, 3, 4, 5]);
  });
});
