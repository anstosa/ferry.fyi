import { round } from "~/lib/math";

export const knotsToMph = (knots: number): number => round(knots * 1.15078, 2);
