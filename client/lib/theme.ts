import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const THEME_PREFERENCE_KEY = "theme-preference";
const THEME_CHANGE_EVENT = "ferry-fyi-theme-change";

const colors = {
  darken: {
    low: "rgba(0, 0, 0, .30)",
  },
  green: {
    dark: "#016f52",
  },
  blue: {
    dark: "#004d61",
  },
  countdown: "#6fb8a6",
  lighten: {
    medium: "rgba(255, 255, 255, .50)",
    high: "rgba(255, 255, 255, .70)",
  },
  white: "#fff",
} as const;

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

const getSystemTheme = (): ResolvedTheme => {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export const getThemePreference = (): ThemePreference => {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const preference = window.localStorage.getItem(THEME_PREFERENCE_KEY);
    return isThemePreference(preference) ? preference : "system";
  } catch {
    return "system";
  }
};

export const getResolvedTheme = (
  preference = getThemePreference()
): ResolvedTheme => (preference === "system" ? getSystemTheme() : preference);

export const applyThemePreference = (
  preference = getThemePreference()
): void => {
  if (typeof document === "undefined") {
    return;
  }
  const resolvedTheme = getResolvedTheme(preference);
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.style.colorScheme =
    preference === "system" ? "light dark" : preference;
};

export const setThemePreference = (preference: ThemePreference): void => {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, preference);
  } catch {
    // Local storage can be unavailable in private or restricted contexts.
  }
  applyThemePreference(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
};

export const initializeTheme = (): (() => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  applyThemePreference();
  if (!window.matchMedia) {
    return () => undefined;
  }
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const updateSystemTheme = (): void => {
    if (getThemePreference() === "system") {
      applyThemePreference("system");
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    }
  };
  mediaQuery.addEventListener("change", updateSystemTheme);
  return () => mediaQuery.removeEventListener("change", updateSystemTheme);
};

export const useThemePreference = (): readonly [
  ThemePreference,
  (preference: ThemePreference) => void,
] => {
  const [preference, setPreference] = useState(getThemePreference);

  useEffect(() => {
    const updatePreference = (): void => setPreference(getThemePreference());
    window.addEventListener("storage", updatePreference);
    window.addEventListener(THEME_CHANGE_EVENT, updatePreference);
    return () => {
      window.removeEventListener("storage", updatePreference);
      window.removeEventListener(THEME_CHANGE_EVENT, updatePreference);
    };
  }, []);

  return [preference, setThemePreference] as const;
};

export const useResolvedTheme = (): ResolvedTheme => {
  const [preference] = useThemePreference();
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    getResolvedTheme(preference)
  );

  useEffect(() => {
    const updateResolvedTheme = (): void =>
      setResolvedTheme(getResolvedTheme(preference));
    updateResolvedTheme();
    window.addEventListener(THEME_CHANGE_EVENT, updateResolvedTheme);
    return () =>
      window.removeEventListener(THEME_CHANGE_EVENT, updateResolvedTheme);
  }, [preference]);

  return resolvedTheme;
};

export { colors };
