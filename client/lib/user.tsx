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
  isUserLoading: boolean;
  userError: Error | null;
  user: null | CurrentUser;
}
interface Actions {
  updateUser: (data: UserUpdatePayload) => Promise<void>;
  refreshUser: () => Promise<void>;
}

type Response = [State, Actions];

let userPromise: Promise<CurrentUser> | null = null;
let userPromiseSubject: string | null = null;

// clear matching cache
const clearUserPromise = (cachedUserPromise: Promise<CurrentUser>): void => {
  // stale cache guard
  if (userPromise === cachedUserPromise) {
    userPromise = null;
    userPromiseSubject = null;
  }
};

// user response guard
const isCurrentUser = (input: unknown): input is CurrentUser => {
  return typeof input === "object" && input !== null;
};

const _useUser = (): Response => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isUserLoading, setUserLoading] = useState<boolean>(false);
  const [hasRequestedUser, setHasRequestedUser] = useState<boolean>(false);
  const [userError, setUserError] = useState<Error | null>(null);
  const {
    user: auth0User,
    getAccessTokenSilently,
    isAuthenticated,
    isLoading: isAuthLoading,
  } = useAuth0();
  const [accessToken, setAccessToken] = useState<string>("");

  const refreshUser = async (inputToken?: string) => {
    const token = inputToken ?? accessToken;
    const subject = auth0User?.sub ?? null;
    // token readiness guard
    if (!token || !subject) {
      return;
    }
    setHasRequestedUser(true);
    setUserLoading(true);
    setUserError(null);
    const cachedUserPromise = userPromise;
    // cached user guard
    if (cachedUserPromise && userPromiseSubject === subject) {
      try {
        setUser(await cachedUserPromise);
        return;
      } catch {
        clearUserPromise(cachedUserPromise);
      }
    }
    const nextUserPromise = get("/user", token).then((response) => {
      // response shape guard
      if (!isCurrentUser(response)) {
        throw new Error("User profile response was empty or invalid");
      }
      return response;
    });
    userPromise = nextUserPromise;
    userPromiseSubject = subject;
    try {
      setUser(await nextUserPromise);
    } catch (error) {
      clearUserPromise(nextUserPromise);
      setUserError(error instanceof Error ? error : new Error(String(error)));
      console.error(error);
    } finally {
      setUserLoading(false);
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
      setHasRequestedUser(true);
      setUserLoading(false);
      setUserError(error instanceof Error ? error : new Error(String(error)));
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
    isUserLoading:
      isAuthLoading ||
      (isAuthenticated &&
        !user &&
        Boolean(auth0User?.sub) &&
        (!hasRequestedUser || isUserLoading)),
    userError,
    user,
  };

  const actions: Actions = {
    updateUser: async (data) => {
      const nextUser = (await post("/user", data, accessToken)) as CurrentUser;
      userPromise = Promise.resolve(nextUser);
      userPromiseSubject = auth0User?.sub ?? null;
      setUser({ ...nextUser });
    },
    refreshUser,
  };

  return [state, actions];
};

export const UserContext = createContext<Response>([
  {
    isAuthenticated: false,
    isUserLoading: false,
    user: null,
    userError: null,
  },
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
