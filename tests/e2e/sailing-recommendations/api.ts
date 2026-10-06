import type { SailingRecommendationRequest } from "shared/contracts/sailingRecommendations";

import {
  fixtureAudit,
  makeFixtureResponse,
  recordRecommendationCall,
} from "./state";

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
  // keep debounced address edits inside the isolated fixture
  if (path === "/sailing-recommendations/address-suggestions") {
    return { available: false, suggestions: [] } as T;
  }
  // require the production feature endpoint
  if (path !== "/sailing-recommendations/v2") {
    throw new Error("unexpected fixture endpoint");
  }
  const input = body as unknown as SailingRecommendationRequest;
  recordRecommendationCall(input);
  // retain the result-shaped skeleton for one deterministic interval
  if (
    fixtureAudit.scenario === "pending-success" ||
    fixtureAudit.scenario === "pending-error"
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return makeFixtureResponse(input) as T;
};
