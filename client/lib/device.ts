import { Capacitor } from "@capacitor/core";
import { Device, DeviceInfo as CapacitorDevice } from "@capacitor/device";
import { useEffect, useState } from "react";

interface DeviceInfo extends CapacitorDevice {
  isNativeMobile: boolean;
}

// synchronous guard for UI that must never flash inside a native app
export const isNativeMobileApp = (): boolean => Capacitor.isNativePlatform();

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
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  const updateDevice = async () => {
    const deviceInfo = await Device.getInfo();
    setDevice({
      ...deviceInfo,
      isNativeMobile:
        deviceInfo.platform === "ios" || deviceInfo.platform === "android",
    });
  };

  useEffect(() => {
    // get info
    updateDevice();
  }, []);

  return device;
};
