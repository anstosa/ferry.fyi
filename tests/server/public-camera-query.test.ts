import { describe, expect, it } from "vitest";

import {
  getPublicCameraFrames,
  selectPublicLineDetectionCameraIds,
} from "../../server/services/public/cameras";

describe("public camera query service", () => {
  it("returns typed invalid-id selection before querying the tracker", () => {
    expect(selectPublicLineDetectionCameraIds(["unknown-camera"])).toEqual({
      cameraIds: [],
      invalidCameraIds: ["unknown-camera"],
    });
  });

  it("returns an empty frame outcome for typed empty camera ids", async () => {
    await expect(getPublicCameraFrames([])).resolves.toEqual({
      frames: {},
      sourceUpdatedAt: null,
    });
  });
});
