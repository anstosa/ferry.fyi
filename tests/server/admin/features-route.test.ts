import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// share feature flag mocks
const flags = vi.hoisted(() => ({
  getFeatureFlagState: vi.fn(),
  updateFeatureFlagState: vi.fn(),
}));
// bind feature flag mocks
vi.mock("~/lib/leaderboardFlags", () => flags);

import { getAdminConfirmationPhrase } from "../../../server/controllers/api/admin/confirmation";
import { adminFeaturesRouter } from "../../../server/controllers/api/admin/features";

// mount the admin routes
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

// cover both policy flags
describe("admin feature controls", () => {
  // reset feature state
  beforeEach(() => {
    vi.clearAllMocks();
    // return the requested flag
    flags.getFeatureFlagState.mockImplementation((name) => ({
      ...state,
      name,
    }));
    // merge partial locked updates
    flags.updateFeatureFlagState.mockImplementation((name, value) => ({
      enabled: state.enabled,
      killSwitch: state.killSwitch,
      name,
      subjects: state.subjects,
      ...value,
    }));
  });

  // verify parent controls
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

    expect(flags.updateFeatureFlagState).toHaveBeenLastCalledWith(
      "leaderboards",
      {
        killSwitch: true,
      }
    );
  });

  // verify automatic controls
  it("controls automatic rollout independently with an exact kill target", async () => {
    await request(app())
      .put("/features/automaticLeaderboardCheckins")
      .send({ enabled: true, subjects: ["auth0|pilot"] })
      .expect(200, {
        enabled: true,
        killSwitch: false,
        name: "automaticLeaderboardCheckins",
        subjects: ["auth0|pilot"],
      });

    const target = "feature:automaticLeaderboardCheckins:kill-switch";
    await request(app())
      .put("/features/automaticLeaderboardCheckins/kill-switch")
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
        name: "automaticLeaderboardCheckins",
        subjects: ["auth0|pilot"],
      });

    expect(flags.updateFeatureFlagState).toHaveBeenLastCalledWith(
      "automaticLeaderboardCheckins",
      { killSwitch: true }
    );
  });
});
