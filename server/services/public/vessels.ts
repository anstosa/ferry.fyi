import type { Vessel as VesselContract } from "shared/contracts/vessels";
import { entries } from "shared/lib/objects";

import { getWsfStatus } from "~/lib/wsf/api";
import { Vessel } from "~/models/Vessel";

export type PublicVesselResult =
  | { status: "available"; vessel: VesselContract }
  | { status: "not-found" | "warming" };

export const getPublicVessels = async (): Promise<
  Record<string, VesselContract>
> => {
  const vessels = await Vessel.getAll();
  const results: Record<string, VesselContract> = {};
  entries(vessels).forEach(([key, vessel]) => {
    results[key] = vessel.serialize();
  });
  return results;
};

export const getPublicVessel = async (
  vesselId: string
): Promise<PublicVesselResult> => {
  const vessel = await Vessel.getByIndex(vesselId);
  if (vessel) {
    return { status: "available", vessel: vessel.serialize() };
  }
  return getWsfStatus().coreReady
    ? { status: "not-found" }
    : { status: "warming" };
};
