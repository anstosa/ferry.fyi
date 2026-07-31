import type { Vessel } from "shared/contracts/vessels";

interface VesselAssignmentSet {
  identity: string;
  vessels: Vessel[];
}

interface VesselContentState {
  routeKey: string;
  sourceUpdatedAt: number | null;
  vesselIdentity: string;
  vessels: Vessel[];
}

interface VisibleVesselContent {
  sourceUpdatedAt: number | null;
  vessels: Vessel[];
}

export function getVesselAssignmentSet(vessels: Vessel[]): VesselAssignmentSet {
  const vesselsById = new Map<string, Vessel>();
  for (const vessel of vessels) {
    if (!vesselsById.has(vessel.id)) {
      vesselsById.set(vessel.id, vessel);
    }
  }
  return {
    identity: `assignments:${JSON.stringify([...vesselsById.keys()].sort())}`,
    vessels: [...vesselsById.values()],
  };
}

export function selectVisibleVesselContent({
  current,
  routeKey,
  seededSourceUpdatedAt,
  seededVessels,
  vesselIdentity,
  vessels,
}: {
  current: VesselContentState;
  routeKey: string;
  seededSourceUpdatedAt: number | null;
  seededVessels: Vessel[];
  vesselIdentity: string;
  vessels: Vessel[];
}): VisibleVesselContent {
  if (
    current.routeKey === routeKey &&
    current.vesselIdentity === vesselIdentity
  ) {
    return {
      sourceUpdatedAt: current.sourceUpdatedAt,
      vessels: current.vessels,
    };
  }
  if (vesselIdentity === "") {
    return {
      sourceUpdatedAt: seededSourceUpdatedAt,
      vessels: seededVessels,
    };
  }
  return { sourceUpdatedAt: null, vessels };
}
