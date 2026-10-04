import type { SailingRecommendationRequest } from "shared/contracts/sailingRecommendations";

import { makeFixtureResponse, recordRecommendationCall } from "./state";

// preserve the production transport error shape for parser coverage
export class ApiError extends Error {
  data: unknown;
  status: number;

  // construct one normalized fixture transport error
  constructor(status: number, data: unknown) {
    super(`fixture api error ${status}`);
    this.data = data;
    this.status = status;
  }
}

// replace only the low-level client transport for a deterministic browser fixture
export const post = async <T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> => {
  // require the production feature endpoint
  if (path !== "/sailing-recommendations") {
    throw new Error("unexpected fixture endpoint");
  }
  const input = body as unknown as SailingRecommendationRequest;
  recordRecommendationCall(input);
  await Promise.resolve();
  return makeFixtureResponse(input) as T;
};
