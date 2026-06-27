import { atom, useAtom } from "jotai";

const trackedVesselAtom = atom<string | null>(null);

// tracked vessel state
export const useTrackedVessel = (): [
  string | null,
  (vesselId: string | null) => void,
] => useAtom(trackedVesselAtom);
