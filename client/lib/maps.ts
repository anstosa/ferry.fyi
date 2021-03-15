import type { MapPoint } from "shared/models/cameras";

export const locationToUrl = ({ latitude, longitude }: MapPoint): string =>
  `https://www.google.com/maps/search/${latitude},${longitude}`;
