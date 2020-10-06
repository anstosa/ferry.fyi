import { assign, map, sortBy } from "lodash";
import { get } from "./lib/api";
import { Vessel, VesselsById } from "../server/lib/wsf";

const API_VESSELS = "/vessels";
const getApiVessel = (id: number): string => `/vessels/${id}`;

let hasAll = false;
const vesselCache: VesselsById = {};

// get vessel data by id
// loads from cache if possible
export const getVessel = async (id: number): Promise<Vessel> => {
  let vessel = vesselCache?.[id];
  if (!vessel) {
    vessel = ((await get(getApiVessel(id))) as unknown) as Vessel;
    // eslint-disable-next-line require-atomic-updates
    vesselCache[id] = vessel;
  }
  return vessel;
};

export const getVessels = async (): Promise<Vessel[]> => {
  if (!hasAll) {
    assign(vesselCache, await get(API_VESSELS));
    // eslint-disable-next-line require-atomic-updates
    hasAll = true;
  }
  return sortBy(map(vesselCache), "name");
};
