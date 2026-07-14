import { useLocalStorage } from "./browser";

export const FAVORITE_ROUTE_IDS_STORAGE_KEY = "favoriteRouteIds";

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

export const useFavoriteRoutes = (): readonly [
  string[],
  (routeId: string) => void,
] => {
  const [favoriteRouteIds, setFavoriteRouteIds] = useLocalStorage<string[]>(
    FAVORITE_ROUTE_IDS_STORAGE_KEY,
    []
  );

  const toggleRoute = (routeId: string): void => {
    setFavoriteRouteIds((currentRouteIds) =>
      toggleFavoriteRoute(currentRouteIds, routeId)
    );
  };

  return [favoriteRouteIds, toggleRoute] as const;
};
