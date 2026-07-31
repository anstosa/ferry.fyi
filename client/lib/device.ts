import { useEffect, useState } from "react";

interface DeviceInfo {
  isNativeMobile: boolean;
  isVirtual: boolean;
  manufacturer: string;
  model: string;
  operatingSystem: string;
  osVersion: string;
  platform: string;
  webViewVersion: string;
}

const webDevice: DeviceInfo = {
  isNativeMobile: false,
  isVirtual: false,
  manufacturer: "",
  model: "",
  operatingSystem: "unknown",
  osVersion: "",
  platform: "web",
  webViewVersion: "",
};

// synchronous guard for UI that must never flash inside a native app
export const isNativeMobileApp = (): boolean =>
  typeof window !== "undefined" &&
  Boolean(
    (
      window as Window & {
        Capacitor?: { isNativePlatform?: () => boolean };
      }
    ).Capacitor?.isNativePlatform?.()
  );

type StandaloneNavigator = Navigator & { standalone?: boolean };

// detect browser installations that run as a home-screen app
export const isInstalledToHomeScreen = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as StandaloneNavigator).standalone === true
  );
};

// native and home-screen installs should not see installation promotion UI
export const isInstalledApp = (): boolean =>
  isNativeMobileApp() || isInstalledToHomeScreen();

// Hook to get user's device info
export const useDevice = (): DeviceInfo | null => {
  const [device, setDevice] = useState<DeviceInfo | null>(webDevice);

  const updateDevice = async () => {
    const { Device } = await import("@capacitor/device");
    const deviceInfo = await Device.getInfo();
    setDevice({
      ...deviceInfo,
      isNativeMobile:
        deviceInfo.platform === "ios" || deviceInfo.platform === "android",
    });
  };

  useEffect(() => {
    if (isNativeMobileApp()) {
      updateDevice().catch(() => {
        // Keep the synchronous web fallback when native device inspection is
        // temporarily unavailable.
      });
    }
  }, []);

  return device;
};
