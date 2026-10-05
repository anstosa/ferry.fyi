import { recordShareCall } from "./state";

interface FixtureShareOptions {
  url?: string;
}

export const Share = {
  // expose the deterministic native path without invoking a platform plugin
  canShare: (): Promise<{ value: boolean }> => Promise.resolve({ value: true }),
  // retain only the fixture URL for browser assertions
  share: (options: FixtureShareOptions): Promise<Record<string, never>> => {
    // require the explicit link supplied by the production result card
    if (typeof options.url !== "string") {
      throw new Error("fixture share url unavailable");
    }
    recordShareCall(options.url);
    return Promise.resolve({});
  },
};
