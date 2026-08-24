import { useAuth0 } from "@auth0/auth0-react";
import { Capacitor } from "@capacitor/core";
import React, {
  type FunctionComponent,
  type PropsWithChildren,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import type { CurrentUser } from "shared/contracts/user";

import { ApiError, del, get, post } from "~/lib/api";
import { getConfiguredAuth0RedirectUri, loginWithAppFlow } from "~/lib/auth";
import {
  type UserActions as Actions,
  UserContext,
  type UserResponse as Response,
  type UserState as State,
} from "~/lib/userContext";

export { useUser } from "~/lib/userContext";

const USER_AUTH_SCOPE = "openid profile email read:current_user offline_access";
interface GetAccessTokenOptions {
  bypassCache?: boolean;
  forceInteractive?: boolean;
}

let userPromise: Promise<CurrentUser> | null = null;
let userPromiseSubject: string | null = null;

interface Auth0ErrorLike {
  error?: unknown;
  error_description?: unknown;
  message?: unknown;
  name?: unknown;
}

// auth error text
const getAuthErrorText = (error: unknown): string => {
  // native error guard
  if (error instanceof Error) {
    const authError = error as Error & Auth0ErrorLike;
    return [
      authError.name,
      authError.message,
      authError.error,
      authError.error_description,
    ]
      .filter(Boolean)
      .map(String)
      .join(" ");
  }
  // object error guard
  if (typeof error === "object" && error !== null) {
    return Object.values(error as Record<string, unknown>)
      .filter(Boolean)
      .map(String)
      .join(" ");
  }
  return String(error);
};

// interactive auth guard
const requiresInteractiveAuth = (error: unknown): boolean => {
  return /consent_required|consent required|login_required|login required|missing refresh token|missing_refresh_token/i.test(
    getAuthErrorText(error)
  );
};

// api authorization guard
const isApiUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

// friendly auth error
const getUserError = (error: unknown): Error => {
  const userError = error instanceof Error ? error : new Error(String(error));
  const authErrorText = getAuthErrorText(error);
  // consent recovery copy
  if (/consent_required|consent required/i.test(authErrorText)) {
    return new Error(
      "Account permissions need approval. Sign in again to continue."
    );
  }
  // login recovery copy
  if (/login_required|login required/i.test(authErrorText)) {
    return new Error("Your login session expired. Sign in again to continue.");
  }
  // refresh-token recovery copy
  if (/missing refresh token|missing_refresh_token/i.test(authErrorText)) {
    return new Error(
      "Your login session needs to be refreshed. Sign in again to continue."
    );
  }
  // api session recovery copy
  if (isApiUnauthorized(error)) {
    return new Error("Your login session expired. Sign in again to continue.");
  }
  return userError;
};

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

// synchronize account state
const _useUser = (): Response => {
  const location = useLocation();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isUserLoading, setUserLoading] = useState<boolean>(false);
  const [hasRequestedUser, setHasRequestedUser] = useState<boolean>(false);
  const [userError, setUserError] = useState<Error | null>(null);
  const {
    user: auth0User,
    getAccessTokenSilently,
    loginWithPopup,
    loginWithRedirect,
    isAuthenticated,
    isLoading: isAuthLoading,
  } = useAuth0();
  const [accessToken, setAccessToken] = useState<string>("");
  const isInteractiveAuthLaunchingRef = useRef<boolean>(false);
  // capture the native callback platform synchronously
  const platform = Capacitor.getPlatform();

  // load account profile
  const loadUser = async (token: string) => {
    const subject = auth0User?.sub ?? null;
    // subject readiness guard
    if (!subject) {
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
      setUserError(getUserError(error));
      console.error(error);
      // authorization recovery guard
      if (isApiUnauthorized(error)) {
        throw error;
      }
    } finally {
      setUserLoading(false);
    }
  };

  // interactive auth redirect
  const requestInteractiveAuth = async (): Promise<void> => {
    const loginOptions = {
      appState: { redirectPath: `${location.pathname}${location.search}` },
      authorizationParams: {
        audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
        prompt: "consent" as const,
        redirect_uri: getConfiguredAuth0RedirectUri(platform),
        scope: USER_AUTH_SCOPE,
      },
    };
    // native browser guard
    if (Capacitor.isNativePlatform()) {
      await loginWithRedirect({
        ...loginOptions,
        openUrl: async (url) => {
          const { Browser } = await import("@capacitor/browser");
          await Browser.open({ url });
        },
      });
      return;
    }
    await loginWithAppFlow({
      loginWithPopup,
      loginWithRedirect,
      options: loginOptions,
    });
  };

  // sync access token
  const getAccessToken = async (options: GetAccessTokenOptions = {}) => {
    const subject = auth0User?.sub;
    // auth0 subject guard
    if (!subject) {
      return undefined;
    }
    try {
      const nextAccessToken = await getAccessTokenSilently({
        ...(options.bypassCache ? { cacheMode: "off" as const } : {}),
        authorizationParams: {
          audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
          scope: USER_AUTH_SCOPE,
        },
      });
      setAccessToken(nextAccessToken);
      await loadUser(nextAccessToken);
      return nextAccessToken;
    } catch (error) {
      setHasRequestedUser(true);
      // stale token recovery guard
      if (isApiUnauthorized(error) && !options.bypassCache) {
        return await getAccessToken({
          ...options,
          bypassCache: true,
        });
      }
      // interactive recovery guard
      if (isApiUnauthorized(error) || requiresInteractiveAuth(error)) {
        // duplicate redirect guard
        if (
          isInteractiveAuthLaunchingRef.current &&
          !options.forceInteractive
        ) {
          return;
        }
        setUserLoading(true);
        setUserError(null);
        isInteractiveAuthLaunchingRef.current = true;
        try {
          await requestInteractiveAuth();
        } catch (redirectError) {
          setUserLoading(false);
          setUserError(getUserError(redirectError));
          console.error(redirectError);
        }
        return;
      }
      setUserLoading(false);
      setUserError(getUserError(error));
      console.error(error);
    }
  };

  const refreshUser = async (inputToken?: string) => {
    const token = inputToken ?? accessToken;
    // token recovery guard
    if (!token) {
      await getAccessToken({ forceInteractive: true });
      return;
    }
    // bypass the prior account snapshot
    userPromise = null;
    userPromiseSubject = null;
    await loadUser(token);
  };

  // fetch metadata
  useEffect(() => {
    getAccessToken();
  }, [getAccessTokenSilently, auth0User?.sub]);

  const state: State = {
    ...user?.app_metadata,
    ...user?.user_metadata,
    favoriteRouteIds: user?.favoriteRouteIds ?? [],
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
    // permanently delete account
    deleteAccount: async (confirmation, continuingBillingAcknowledged) => {
      const token = await getAccessToken();
      // authenticated deletion guard
      if (!token) {
        throw new Error("Sign in again before deleting your account.");
      }
      await del(
        "/user",
        { confirmation, continuingBillingAcknowledged },
        token
      );
      userPromise = null;
      userPromiseSubject = null;
      setUser(null);
    },
    getAccessToken,
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

export { UserContext } from "~/lib/userContext";
export const UserProvider: FunctionComponent<PropsWithChildren> = ({
  children,
}) => {
  const user = _useUser();
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
};
