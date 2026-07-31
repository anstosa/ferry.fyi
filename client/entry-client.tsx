import { startClientAppWhenReady } from "./clientRuntime";

export * from "./clientRuntime";

// Tests import this module without the document bootstrap marker. The built
// document sets that marker before loading this executable entry, keeping the
// runtime composition directly testable.
if (
  typeof window !== "undefined" &&
  (window as Window & { __FERRY_FYI_BOOTSTRAP__?: boolean })
    .__FERRY_FYI_BOOTSTRAP__
) {
  startClientAppWhenReady();
}
