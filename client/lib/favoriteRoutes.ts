import {
  isFavoriteRoute,
  normalizeFavoriteRouteIds,
  toggleFavoriteRoute,
} from "./favoriteRouteHelpers";
import { useUser } from "./userContext";

export { isFavoriteRoute, normalizeFavoriteRouteIds, toggleFavoriteRoute };

export const useFavoriteRoutes = (): readonly [
  string[],
  (routeId: string) => Promise<void>,
] => {
  const [{ favoriteRouteIds }, { updateUser }] = useUser();
  const normalizedFavoriteRouteIds = normalizeFavoriteRouteIds(
    favoriteRouteIds ?? []
  );

  const toggleRoute = async (routeId: string): Promise<void> => {
    await updateUser({
      favoriteRouteIds: toggleFavoriteRoute(
        normalizedFavoriteRouteIds,
        routeId
      ),
    });
  };

  return [normalizedFavoriteRouteIds, toggleRoute] as const;
};
