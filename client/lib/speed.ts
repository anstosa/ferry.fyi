import { round } from "shared/lib/math";

export const knotsToMph = (knots: number): number => round(knots * 1.15078, 2);
