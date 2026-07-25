import type {
  ForegroundTerminalCheckInRequest,
  ForegroundTerminalCheckInResult,
  ForegroundTerminalPresenceResult,
  Leaderboard,
  LeaderboardCheckInStatus,
  LeaderboardPeriod,
  LeaderboardPreferences,
  LeaderboardPreferencesUpdate,
  VesselCheckInRequest,
  VesselCheckInResult,
} from "shared/contracts/leaderboards";

import { get, post, put } from "~/lib/api";

export const leaderboardPeriodOrder: LeaderboardPeriod[] = [
  "week",
  "month",
  "all",
];

/** Returns the most recent period that has leaderboard entries. */
export const getFirstNonEmptyLeaderboard = async (
  load: (period: LeaderboardPeriod) => Promise<Leaderboard>
): Promise<Leaderboard | null> => {
  for (const period of leaderboardPeriodOrder) {
    const leaderboard = await load(period);
    if (leaderboard.ranks.length) {
      return leaderboard;
    }
  }
  return null;
};

export const getTerminalLeaderboard = (
  terminalId: string,
  period: LeaderboardPeriod
): Promise<Leaderboard> =>
  get(
    `/leaderboards/terminals/${encodeURIComponent(terminalId)}?period=${period}`
  );

export const getVesselLeaderboard = (
  vesselId: string,
  period: LeaderboardPeriod
): Promise<Leaderboard> =>
  get(`/leaderboards/vessels/${encodeURIComponent(vesselId)}?period=${period}`);

export const getTerminalCheckInStatus = (
  terminalId: string,
  accessToken: string
): Promise<LeaderboardCheckInStatus> =>
  get(
    `/leaderboards/checkins/terminals/${encodeURIComponent(terminalId)}/status`,
    accessToken
  );

export const getVesselCheckInStatus = (
  vesselId: string,
  accessToken: string
): Promise<LeaderboardCheckInStatus> =>
  get(
    `/leaderboards/checkins/vessels/${encodeURIComponent(vesselId)}/status`,
    accessToken
  );

export const getLeaderboardPreferences = (
  accessToken: string
): Promise<LeaderboardPreferences> =>
  get("/leaderboards/preferences", accessToken);

export const updateLeaderboardPreferences = (
  preferences: LeaderboardPreferencesUpdate,
  accessToken: string
): Promise<LeaderboardPreferences> =>
  put(
    "/leaderboards/preferences",
    preferences as unknown as Record<string, unknown>,
    accessToken
  );

export type TerminalCheckInResponse = ForegroundTerminalCheckInResult & {
  notification?: { action: "replace"; kind: "checkin"; terminalId: string };
};

export const submitTerminalCheckIn = (
  input: ForegroundTerminalCheckInRequest,
  accessToken: string
): Promise<TerminalCheckInResponse> =>
  post(
    "/leaderboards/checkins/terminals",
    input as unknown as Record<string, unknown>,
    accessToken
  );

/**
 * Records that an already-credited user has definitely left a terminal. The
 * server validates this independently and never retains the submitted fix.
 */
export const submitTerminalDeparture = (
  input: ForegroundTerminalCheckInRequest,
  accessToken: string
): Promise<ForegroundTerminalPresenceResult> =>
  post(
    "/leaderboards/presence/terminals",
    input as unknown as Record<string, unknown>,
    accessToken
  );

export const submitVesselCheckIn = (
  input: VesselCheckInRequest,
  accessToken: string
): Promise<VesselCheckInResult> =>
  post(
    "/leaderboards/checkins/vessels",
    input as unknown as Record<string, unknown>,
    accessToken
  );
