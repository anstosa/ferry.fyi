import { useEffect, useState } from "react";

const SIMULATED_VESSEL_EVENT = "ferry-fyi:simulated-vessel";

let simulatedVesselId: string | null = null;

// localhost guard
export const isLocalhostSimulationEnabled = (): boolean => {
  // browser guard
  if (typeof window === "undefined") {
    return false;
  }
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
};

// simulation event dispatch
const emitSimulationChange = (): void => {
  // browser guard
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(SIMULATED_VESSEL_EVENT));
};

// set simulated boat
export const setSimulatedVessel = (vesselId: string): void => {
  // localhost guard
  if (!isLocalhostSimulationEnabled()) {
    return;
  }
  simulatedVesselId = vesselId;
  emitSimulationChange();
};

// clear simulated boat
export const clearSimulatedVessel = (): void => {
  simulatedVesselId = null;
  emitSimulationChange();
};

// simulated boat hook
export const useSimulatedVesselId = (): string | null => {
  const [vesselId, setVesselId] = useState<string | null>(simulatedVesselId);

  // subscribe to simulation
  useEffect(() => {
    // sync simulated vessel
    const updateVesselId = (): void => {
      setVesselId(simulatedVesselId);
    };
    window.addEventListener(SIMULATED_VESSEL_EVENT, updateVesselId);
    return () => {
      window.removeEventListener(SIMULATED_VESSEL_EVENT, updateVesselId);
    };
  }, []);

  return vesselId;
};

// test reset helper
export const resetOnboardSimulationForTest = (): void => {
  simulatedVesselId = null;
};
