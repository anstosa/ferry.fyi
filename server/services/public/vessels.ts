import type {
  Vessel as VesselContract,
  VesselSnapshot,
} from "shared/contracts/vessels";
import { entries } from "shared/lib/objects";

import { getWsfStatus } from "~/lib/wsf/api";
import { Vessel } from "~/models/Vessel";

export type PublicVesselResult =
  | { status: "available"; vessel: VesselContract }
  | { status: "not-found" | "warming" };

export const getPublicVessels = async (): Promise<
  Record<string, VesselContract>
> => (await getPublicVesselSnapshot()).vessels;

/** Return one coherent fleet snapshot without exposing per-vessel internals. */
export const getPublicVesselSnapshot = async (): Promise<VesselSnapshot> => {
  const vessels = await Vessel.getAll();
  const results: Record<string, VesselContract> = {};
  const sourceTimes: number[] = [];
  entries(vessels).forEach(([key, vessel]) => {
    results[key] = vessel.serialize();
    if (Number.isFinite(vessel.statusUpdatedAt)) {
      sourceTimes.push(vessel.statusUpdatedAt / 1000);
    }
  });
  return {
    sourceUpdatedAt: sourceTimes.length ? Math.min(...sourceTimes) : null,
    vessels: results,
  };
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
