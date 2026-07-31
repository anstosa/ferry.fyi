import { createContext, useContext } from "react";
import type {
  AppMetadata,
  CurrentUser,
  UserMetadata,
  UserUpdatePayload,
} from "shared/contracts/user";

export interface UserState extends AppMetadata, UserMetadata {
  favoriteRouteIds: string[];
  isAuthenticated: boolean;
  isUserLoading: boolean;
  user: CurrentUser | null;
  userError: Error | null;
}

export interface UserActions {
  refreshUser: () => Promise<void>;
  updateUser: (data: UserUpdatePayload) => Promise<void>;
}

export type UserResponse = [UserState, UserActions];

export const anonymousUser: UserResponse = [
  {
    favoriteRouteIds: [],
    isAuthenticated: false,
    isUserLoading: false,
    user: null,
    userError: null,
  },
  {
    refreshUser: async () => await Promise.resolve(),
    updateUser: async () => await Promise.resolve(),
  },
];

export const UserContext = createContext<UserResponse>(anonymousUser);

/** Browser-neutral reader for anonymous document trees and live providers. */
export const useUser = (): UserResponse => useContext(UserContext);
