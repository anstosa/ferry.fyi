import { useAuth0 } from "@auth0/auth0-react";
import React, {
  createContext,
  FunctionComponent,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  AppMetadata,
  CurrentUser,
  UserMetadata,
  UserUpdatePayload,
} from "shared/contracts/user";

import { get, post } from "~/lib/api";

interface State extends AppMetadata, UserMetadata {
  isAuthenticated: boolean;
  user: null | CurrentUser;
}
interface Actions {
  updateUser: (data: UserUpdatePayload) => Promise<void>;
  refreshUser: () => Promise<void>;
}

type Response = [State, Actions];

let userPromise: Promise<CurrentUser>;

const _useUser = (): Response => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const {
    user: auth0User,
    getAccessTokenSilently,
    isAuthenticated,
  } = useAuth0();
  const [accessToken, setAccessToken] = useState<string>("");

  const refreshUser = async (inputToken?: string) => {
    // cached user guard
    if (userPromise) {
      setUser(await userPromise);
      return;
    }
    try {
      // eslint-disable-next-line require-atomic-updates
      userPromise = get(
        "/user",
        inputToken ?? accessToken
      ) as Promise<CurrentUser>;
      setUser(await userPromise);
    } catch (error) {
      console.error(error);
    }
  };

  const getAccessToken = async () => {
    // auth0 subject guard
    if (!auth0User?.sub) {
      return;
    }
    try {
      const accessToken = await getAccessTokenSilently();
      setAccessToken(accessToken);
      await refreshUser(accessToken);
    } catch (error) {
      console.error(error);
    }
  };

  // fetch metadata
  useEffect(() => {
    getAccessToken();
  }, [getAccessTokenSilently, auth0User?.sub]);

  const state: State = {
    ...user?.app_metadata,
    ...user?.user_metadata,
    isAuthenticated,
    user,
  };

  const actions: Actions = {
    updateUser: async (data) => {
      setUser({ ...((await post("/user", data, accessToken)) as CurrentUser) });
    },
    refreshUser,
  };

  return [state, actions];
};

export const UserContext = createContext<Response>([
  { isAuthenticated: false, user: null },
  {
    updateUser: async () => await Promise.resolve(),
    refreshUser: async () => await Promise.resolve(),
  },
]);
export const UserProvider: FunctionComponent<PropsWithChildren> = ({
  children,
}) => {
  const user = _useUser();
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
};
export const useUser = () => useContext(UserContext);
