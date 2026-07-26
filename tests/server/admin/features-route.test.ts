import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({
  getFeatureFlagState: vi.fn(),
  setFeatureFlagState: vi.fn(),
}));
vi.mock("~/lib/leaderboardFlags", () => flags);

import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";
import { adminFeaturesRouter } from "../../../server/controllers/api/admin/features";

const app = (): express.Express => {
  const value = express();
  value.use(express.json());
  value.use("/features", adminFeaturesRouter);
  return value;
};

const state = {
  enabled: false,
  killSwitch: false,
  name: "leaderboards",
  subjects: ["auth0|pilot"],
};

describe("admin feature controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.getFeatureFlagState.mockResolvedValue(state);
    flags.setFeatureFlagState.mockImplementation(async (_name, value) => ({
      name: "leaderboards",
      ...value,
    }));
  });

  it("requires typed confirmation for the kill switch while allowing explicit subject access updates", async () => {
    await request(app())
      .put("/features/leaderboards")
      .send({ enabled: false, subjects: ["auth0|next"] })
      .expect(200, {
        enabled: false,
        killSwitch: false,
        name: "leaderboards",
        subjects: ["auth0|next"],
      });

    await request(app())
      .put("/features/leaderboards/kill-switch")
      .send({ enabled: true })
      .expect(400);

    const target = "feature:leaderboards:kill-switch";
    await request(app())
      .put("/features/leaderboards/kill-switch")
      .send({
        action: "set-feature-kill-switch",
        confirmation: getAdminConfirmationPhrase(
          "set-feature-kill-switch",
          target
        ),
        enabled: true,
        target,
      })
      .expect(200, {
        enabled: false,
        killSwitch: true,
        name: "leaderboards",
        subjects: ["auth0|pilot"],
      });

    expect(flags.setFeatureFlagState).toHaveBeenLastCalledWith("leaderboards", {
      ...state,
      killSwitch: true,
    });
  });
});
