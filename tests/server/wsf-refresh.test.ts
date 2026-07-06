import { beforeEach, describe, expect, it, vi } from "vitest";

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

const scheduleRefreshModel = vi.hoisted(() => ({
  updateSchedules: vi.fn(),
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

const loggerModel = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: loggerModel,
}));

vi.mock("~/lib/forecast", () => forecastModel);

vi.mock("~/lib/weather/updateForecasts", () => weatherRefreshModel);

vi.mock("~/lib/wsf/api", () => wsfApiModel);

vi.mock("~/lib/wsf/seed", () => seedModel);

vi.mock("~/lib/wsf/updateCameras", () => cameraModel);

vi.mock("~/lib/wsf/updateCapacity", () => capacityModel);

vi.mock("~/lib/wsf/updateNormalRouteVessels", () => normalRouteVesselModel);

vi.mock("~/lib/wsf/updateRoutes", () => routeModel);

vi.mock("~/lib/wsf/updateSchedules", () => scheduleRefreshModel);

vi.mock("~/lib/wsf/updateTerminals", () => terminalModel);

vi.mock("~/lib/wsf/updateVessels", () => vesselModel);

const { updateDaily, updateLong, updateScheduleCache, updateShort } =
  await import("../../server/lib/wsf");

describe("WSF refresh", () => {
  // reset mocks
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleRefreshModel.updateSchedules.mockResolvedValue(undefined);
  });

  // failure isolation
  it("starts best-effort weather refresh when estimates are skipped", async () => {
    vesselModel.updateVesselStatus.mockResolvedValue(undefined);
    capacityModel.updateCapacity.mockResolvedValue([]);
    weatherRefreshModel.updateWeatherForecasts.mockResolvedValue({
      recordsWritten: 0,
      skipped: false,
    });

    await updateShort();

    expect(weatherRefreshModel.updateWeatherForecasts).toHaveBeenCalled();
    expect(forecastModel.updateEstimates).not.toHaveBeenCalled();
  });

  // overlap guard
  it("skips overlapping short refreshes", async () => {
    let resolveCapacity: ((schedules: []) => void) | undefined;
    vesselModel.updateVesselStatus.mockResolvedValue(undefined);
    capacityModel.updateCapacity.mockReturnValue(
      new Promise<[]>((resolve) => {
        // resolve handle
        resolveCapacity = resolve;
      })
    );
    weatherRefreshModel.updateWeatherForecasts.mockResolvedValue({
      recordsWritten: 0,
      skipped: false,
    });

    const firstRefresh = updateShort();
    await Promise.resolve();
    await updateShort();
    resolveCapacity?.([]);
    await firstRefresh;

    expect(vesselModel.updateVesselStatus).toHaveBeenCalledOnce();
    expect(capacityModel.updateCapacity).toHaveBeenCalledOnce();
    expect(loggerModel.info).toHaveBeenCalledWith(
      "Skipped short WSF refresh; previous refresh is still running"
    );
  });

  // schedule cache warmup
  it("refreshes schedules as a background cache warmup", async () => {
    await updateScheduleCache();

    expect(scheduleRefreshModel.updateSchedules).toHaveBeenCalledOnce();
  });

  // daily inference
  it("updates normal route vessel assignments during daily refresh", async () => {
    normalRouteVesselModel.updateNormalRouteVessels.mockResolvedValue(undefined);

    await updateDaily();

    expect(
      normalRouteVesselModel.updateNormalRouteVessels
    ).toHaveBeenCalledOnce();
  });

  // warming cleanup
  it("clears warming state when long refresh fails", async () => {
    cameraModel.updateCameras.mockRejectedValue(new Error("db disconnected"));
    vesselModel.updateVessels.mockResolvedValue(undefined);

    await expect(updateLong()).rejects.toThrow(Error);

    expect(wsfApiModel.setWsfWarming).toHaveBeenNthCalledWith(1, true);
    expect(wsfApiModel.setWsfWarming).toHaveBeenLastCalledWith(false);
  });
});
