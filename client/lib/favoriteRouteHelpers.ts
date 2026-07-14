export const normalizeFavoriteRouteIds = (routeIds: string[]): string[] =>
  [...new Set(routeIds)].sort((left, right) => left.localeCompare(right));

export const isFavoriteRoute = (
  routeIds: string[],
  routeId?: string
): boolean => Boolean(routeId && routeIds.includes(routeId));

export const toggleFavoriteRoute = (
  routeIds: string[],
  routeId: string
): string[] => {
  if (routeIds.includes(routeId)) {
    return routeIds.filter((id) => id !== routeId);
  }
  return normalizeFavoriteRouteIds([...routeIds, routeId]);
};
