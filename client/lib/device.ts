import { DeviceInfo as CapacitorDevice, Device } from "@capacitor/device";
import { useEffect, useState } from "react";

interface DeviceInfo extends CapacitorDevice {
  isNativeMobile: boolean;
}

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
