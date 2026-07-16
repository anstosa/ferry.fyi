// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  getResolvedTheme,
  getThemePreference,
  initializeTheme,
  setThemePreference,
} from "../../client/lib/theme";

const stubMatchMedia = (isDark: boolean) => {
  let listener: (() => void) | undefined;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      addEventListener: (_event: string, callback: () => void) => {
        listener = callback;
      },
      matches: isDark,
      removeEventListener: vi.fn(),
    })
  );
  return () => listener?.();
};

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("theme preferences", () => {
  it("defaults to the system preference", () => {
    expect(getThemePreference()).toBe("system");
  });

  it("resolves the system preference from the device color scheme", () => {
    stubMatchMedia(true);

    expect(getResolvedTheme("system")).toBe("dark");
  });

  it("updates the applied system theme when the device changes", () => {
    const dispatchChange = stubMatchMedia(true);
    const cleanup = initializeTheme();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      })
    );
    dispatchChange();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    cleanup();
  });

  it("persists and applies an explicit theme", () => {
    setThemePreference("dark");

    expect(getThemePreference()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("removes the dark class for an explicit light preference", () => {
    document.documentElement.classList.add("dark");

    applyThemePreference("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
