import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientBuildEnvDefines } from "../../client/vite.shared";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  run: vi.fn(),
  pipelineOptions: vi.fn(),
  providerOptions: vi.fn(),
  prepare: vi.fn(),
  classify: vi.fn(),
  schedules: vi.fn(),
  timing: vi.fn(),
}));

// isolate storage and every paid or upstream effect
vi.mock("../../server/lib/openaiCameraStore", () => ({
  databaseOpenaiCameraStore: { read: mocks.read },
}));
// inspect wiring without preparing live camera images
vi.mock("../../server/lib/openaiCameraImages", () => ({
  OpenaiCameraImageClient: class {
    prepare = mocks.prepare;
  },
}));
// inspect the dedicated credential without contacting a provider
vi.mock("../../server/lib/openaiCameraProvider", () => ({
  OpenaiCameraProvider: class {
    // retain constructor arguments only inside the test
    constructor(options: unknown) {
      mocks.providerOptions(options);
    }

    classify = mocks.classify;
  },
}));
// keep orchestration tests independent of runtime wiring
vi.mock("../../server/lib/openaiCameraPipeline", () => ({
  OpenaiCameraPipeline: class {
    // capture the injected production dependencies
    constructor(options: unknown) {
      mocks.pipelineOptions(options);
    }

    run = mocks.run;
  },
}));
// reuse the app's prediction boundary rather than a raw slot timestamp
vi.mock("../../shared/lib/projectedTiming", () => ({
  getProjectedTiming: mocks.timing,
}));
// expose cached schedules without a database connection
vi.mock("../../server/models/Schedule", () => ({
  Schedule: { getAll: mocks.schedules },
}));

import {
  getOpenaiCameraConfiguration,
  getOpenaiCameraDepartures,
  getOpenaiCameraInferenceKey,
  getOpenaiCameraStatus,
  refreshOpenaiCameraPipeline,
} from "../../server/lib/openaiCameraRuntime";

// configure a dedicated mocked provider without selecting a real model
const configure = () => {
  vi.stubEnv("OPENAI_CAMERA_ENABLED", "true");
  vi.stubEnv("OPENAI_CAMERA_API_KEY", "dedicated-camera-test-secret");
  vi.stubEnv("OPENAI_CAMERA_MODEL", "fixture-model-not-for-live-use");
  vi.stubEnv("OPENAI_CAMERA_PREPROCESSOR_ENDPOINT", "http://processor/prepare");
};

// verify fail-closed production wiring and private inspection
describe("OpenAI camera runtime", () => {
  // reset configuration without reading any developer credentials
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_CAMERA_ENABLED", "false");
    vi.stubEnv("OPENAI_CAMERA_API_KEY", "");
    vi.stubEnv("OPENAI_CAMERA_MODEL", "");
    vi.stubEnv("OPENAI_CAMERA_PREPROCESSOR_ENDPOINT", "");
    vi.stubEnv("OPENAI_CAMERA_IMAGE_DETAIL", "auto");
    mocks.read.mockResolvedValue({ version: 1, cameras: {}, terminals: {} });
    mocks.run.mockResolvedValue(null);
    mocks.schedules.mockReturnValue({});
  });

  // restore the surrounding process environment
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // actual prompt changes invalidate cache even without a manual version bump
  it("hashes prompt text as well as model and geometry into inference identity", () => {
    const first = getOpenaiCameraInferenceKey(
      "fixture-model",
      "auto",
      [],
      "first prompt"
    );
    expect(
      getOpenaiCameraInferenceKey("fixture-model", "auto", [], "second prompt")
    ).not.toBe(first);
    expect(
      getOpenaiCameraInferenceKey(
        "different-fixture-model",
        "auto",
        [],
        "first prompt"
      )
    ).not.toBe(first);
    expect(
      getOpenaiCameraInferenceKey("fixture-model", "auto", [], "first prompt")
    ).toBe(first);
  });

  // dedicated credentials stay outside both browser and ssr public defines
  it("never includes camera secrets in browser-safe build configuration", () => {
    configure();
    const defines = JSON.stringify(clientBuildEnvDefines());
    expect(defines).not.toContain("OPENAI_CAMERA_API_KEY");
    expect(defines).not.toContain("dedicated-camera-test-secret");
  });

  // a shared key must not accidentally enable the dedicated provider
  it("does no work without explicit enablement, model, key and preprocessor", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unrelated-feature-secret");
    await refreshOpenaiCameraPipeline();
    expect(getOpenaiCameraConfiguration().active).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
    configure();
    vi.stubEnv("OPENAI_CAMERA_MODEL", "");
    await refreshOpenaiCameraPipeline();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.providerOptions).not.toHaveBeenCalled();
  });

  // independent kill switch remains authoritative even with valid configuration
  it("requires explicit enablement and rejects unsupported detail values", async () => {
    configure();
    vi.stubEnv("OPENAI_CAMERA_ENABLED", "false");
    await refreshOpenaiCameraPipeline();
    expect(mocks.run).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_CAMERA_ENABLED", "true");
    vi.stubEnv("OPENAI_CAMERA_IMAGE_DETAIL", "unsupported");
    await refreshOpenaiCameraPipeline();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  // bind only the isolated store and dedicated provider
  it("wires the configured pipeline without returning its credential", async () => {
    configure();
    await refreshOpenaiCameraPipeline();
    expect(mocks.providerOptions).toHaveBeenCalledWith({
      apiKey: "dedicated-camera-test-secret",
      model: "fixture-model-not-for-live-use",
      detail: "auto",
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    const options = mocks.pipelineOptions.mock.calls[0][0];
    expect(options.inferenceKey).toMatch(/^[a-f0-9]{64}$/);
    expect(options.definitions).toHaveLength(8);
    const status = await getOpenaiCameraStatus();
    expect(status).toMatchObject({ active: true, storageAvailable: true });
    expect(JSON.stringify(status)).not.toContain(
      "dedicated-camera-test-secret"
    );
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  // owner reads never cause paid or live-source work
  it("remains inspectable when the new migration has not been applied", async () => {
    mocks.read.mockRejectedValue(
      new Error("database internals must remain private")
    );
    const status = await getOpenaiCameraStatus();
    expect(status).toMatchObject({
      active: false,
      storageAvailable: false,
      state: null,
    });
    expect(JSON.stringify(status)).not.toContain("database internals");
    expect(status.prompt).toContain("Do not include explanations");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  // delay-aware projection remains the sole source of departure timing
  it("uses predicted departure and retains cancellation/vehicle eligibility", () => {
    const slot = { time: 100, allowsVehicles: true };
    const cancelled = {
      time: 200,
      allowsVehicles: false,
      cancellationReason: "tidal",
    };
    const slots = [slot, cancelled];
    mocks.schedules.mockReturnValue({ crossing: { terminalId: "5", slots } });
    mocks.timing.mockReturnValue({
      departureTime: { toMillis: () => 123_000 },
      isCancelled: false,
    });
    expect(getOpenaiCameraDepartures()).toEqual([
      {
        terminalId: "5",
        predictedDepartureAt: 123_000,
        allowsVehicles: true,
        isCancelled: false,
      },
      {
        terminalId: "5",
        predictedDepartureAt: 123_000,
        allowsVehicles: false,
        isCancelled: true,
      },
    ]);
    expect(mocks.timing).toHaveBeenCalledWith({ schedule: slots, slot });
  });
});
