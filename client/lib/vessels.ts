import { get } from "~/lib/api";
import { sortBy } from "shared/lib/arrays";
import { values } from "shared/lib/objects";
import { Vessel } from "shared/contracts/vessels";

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

export const getVessels = async (): Promise<Vessel[]> => {
  if (!hasAll) {
    Object.assign(vesselCache, await get(API_VESSELS));
    // eslint-disable-next-line require-atomic-updates
    hasAll = true;
  }
  return sortBy(values(vesselCache), "name");
};
