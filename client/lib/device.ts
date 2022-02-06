import { Device, DeviceInfo } from "@capacitor/device";
import { useEffect, useState } from "react";

// Hook to get user's device info
export const useDevice = (): DeviceInfo | null => {
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  const updateDevice = async () => {
    setDevice(await Device.getInfo());
  };

  useEffect(() => {
    // get info
    updateDevice();
  }, []);

  return device;
};
