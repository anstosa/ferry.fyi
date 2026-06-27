import { useEffect, useState } from "react";
import { Vessel } from "shared/contracts/vessels";
import { sortBy } from "shared/lib/arrays";
import { values } from "shared/lib/objects";

import { get } from "~/lib/api";

const API_VESSELS = "/vessels";
const getApiVessel = (id: string): string => `/vessels/${id}`;

let hasAll = false;
const vesselCache: Record<string, Vessel> = {};

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
    const updateVessels = async (): Promise<void> => {
      const vessels = await getVessels({ force: true });
      // mount guard
      if (isMounted) {
        setVessels(vessels);
      }
    };

    updateVessels();
    const interval = window.setInterval(updateVessels, refreshMs);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [isEnabled, refreshMs]);

  return vessels;
};
