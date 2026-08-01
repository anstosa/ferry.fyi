import { useEffect, useState } from "react";
import { Vessel, VesselSnapshot } from "shared/contracts/vessels";
import { sortBy } from "shared/lib/arrays";
import { values } from "shared/lib/objects";

import { get, post } from "~/lib/api";

const API_VESSELS = "/vessels";
const getApiVessel = (id: string): string => `/vessels/${id}`;
const LIVE_VESSEL_SNAPSHOT_MAX_AGE_MS = 55 * 1000;

let hasAll = false;
const vesselCache: Record<string, Vessel> = {};
let latestVesselSnapshot:
  | { receivedAt: number; sourceUpdatedAt: number | null; vessels: Vessel[] }
  | undefined;

// get vessel data by id
// loads from cache if possible
export const getVessel = async (id: string): Promise<Vessel> => {
  let vessel = vesselCache?.[id];
  if (!vessel) {
    vessel = await get<Vessel>(getApiVessel(id));
    // eslint-disable-next-line require-atomic-updates
    vesselCache[id] = vessel;
  }
  return vessel;
};

export const getVessels = async (
  options: { force?: boolean } = {}
): Promise<Vessel[]> => {
  // cache refresh guard
  if (options.force || !hasAll) {
    Object.assign(vesselCache, await get(API_VESSELS));
    // eslint-disable-next-line require-atomic-updates
    hasAll = true;
  }
  return sortBy(values(vesselCache), "name");
};

const storeVesselSnapshot = ({
  sourceUpdatedAt,
  vessels,
}: VesselSnapshot): { sourceUpdatedAt: number | null; vessels: Vessel[] } => {
  Object.assign(vesselCache, vessels);
  hasAll = true;
  const stored = {
    sourceUpdatedAt,
    vessels: sortBy(values(vesselCache), "name"),
  };
  latestVesselSnapshot = { ...stored, receivedAt: Date.now() };
  return stored;
};

export const getVesselSnapshot = async (
  options: { maxAgeMs?: number } = {}
): Promise<{
  sourceUpdatedAt: number | null;
  vessels: Vessel[];
}> => {
  const snapshotAge = latestVesselSnapshot
    ? Date.now() - latestVesselSnapshot.receivedAt
    : null;
  if (
    latestVesselSnapshot &&
    snapshotAge !== null &&
    snapshotAge >= 0 &&
    snapshotAge < (options.maxAgeMs ?? 0)
  ) {
    return latestVesselSnapshot;
  }
  return storeVesselSnapshot(await get<VesselSnapshot>("/vessels/snapshot"));
};

export const refreshVessels = async (): Promise<{
  sourceUpdatedAt: number | null;
  vessels: Vessel[];
}> => {
  return storeVesselSnapshot(
    await post<VesselSnapshot>("/vessels/refresh", {})
  );
};

export const useLiveVessels = (
  isEnabled: boolean,
  refreshMs: number
): Vessel[] => {
  const [vessels, setVessels] = useState<Vessel[]>([]);

  useEffect(() => {
    // enabled guard
    if (!isEnabled) {
      setVessels([]);
      return;
    }
    let isMounted = true;
    let isRefreshing = false;
    const updateVessels = async (): Promise<void> => {
      if (isRefreshing || document.visibilityState !== "visible") {
        return;
      }
      isRefreshing = true;
      try {
        const { vessels } = await getVesselSnapshot({
          maxAgeMs: LIVE_VESSEL_SNAPSHOT_MAX_AGE_MS,
        });
        // mount guard
        if (isMounted) {
          setVessels(vessels);
        }
      } finally {
        // eslint-disable-next-line require-atomic-updates -- this effect owns the flag.
        isRefreshing = false;
      }
    };

    updateVessels().catch(console.error);
    const interval = window.setInterval(() => {
      updateVessels().catch(console.error);
    }, refreshMs);
    const handleVisibilityChange = (): void => {
      updateVessels().catch(console.error);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isEnabled, refreshMs]);

  return vessels;
};
