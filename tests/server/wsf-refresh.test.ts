import { describe, expect, it, vi } from "vitest";

const forecastModel = vi.hoisted(() => ({
  updateEstimates: vi.fn(),
}));

const weatherRefreshModel = vi.hoisted(() => ({
  updateWeatherForecasts: vi.fn(),
}));

const wsfApiModel = vi.hoisted(() => ({
  setWsfCoreReady: vi.fn(),
  setWsfWarming: vi.fn(),
}));

const seedModel = vi.hoisted(() => ({
  hydrateWsfSeed: vi.fn(),
}));

const cameraModel = vi.hoisted(() => ({
  updateCameras: vi.fn(),
}));

const capacityModel = vi.hoisted(() => ({
  updateCapacity: vi.fn(),
}));

const normalRouteVesselModel = vi.hoisted(() => ({
  updateNormalRouteVessels: vi.fn(),
}));

const routeModel = vi.hoisted(() => ({
  updateRoutes: vi.fn(),
}));

const terminalModel = vi.hoisted(() => ({
  updateTerminals: vi.fn(),
}));

const vesselModel = vi.hoisted(() => ({
  updateVessels: vi.fn(),
  updateVesselStatus: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { error: vi.fn() },
}));

vi.mock("~/lib/forecast", () => forecastModel);

vi.mock("~/lib/weather/updateForecasts", () => weatherRefreshModel);

vi.mock("~/lib/wsf/api", () => wsfApiModel);

vi.mock("~/lib/wsf/seed", () => seedModel);

vi.mock("~/lib/wsf/updateCameras", () => cameraModel);

vi.mock("~/lib/wsf/updateCapacity", () => capacityModel);

vi.mock("~/lib/wsf/updateNormalRouteVessels", () => normalRouteVesselModel);

vi.mock("~/lib/wsf/updateRoutes", () => routeModel);

vi.mock("~/lib/wsf/updateTerminals", () => terminalModel);

vi.mock("~/lib/wsf/updateVessels", () => vesselModel);

const { updateDaily, updateShort } = await import("../../server/lib/wsf");

describe("WSF refresh", () => {
  // failure isolation
  it("starts best-effort weather refresh when estimate refresh fails", async () => {
    vesselModel.updateVesselStatus.mockResolvedValue(undefined);
    capacityModel.updateCapacity.mockResolvedValue(undefined);
    forecastModel.updateEstimates.mockRejectedValue(new Error("estimate failed"));
    weatherRefreshModel.updateWeatherForecasts.mockResolvedValue({
      recordsWritten: 0,
      skipped: false,
    });

    await expect(updateShort()).rejects.toThrow(Error);

    expect(weatherRefreshModel.updateWeatherForecasts).toHaveBeenCalled();
  });

  // daily inference
  it("updates normal route vessel assignments during daily refresh", async () => {
    normalRouteVesselModel.updateNormalRouteVessels.mockResolvedValue(undefined);

    await updateDaily();

    expect(
      normalRouteVesselModel.updateNormalRouteVessels
    ).toHaveBeenCalledOnce();
  });
});
