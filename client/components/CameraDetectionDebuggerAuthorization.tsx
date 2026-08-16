import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useRef } from "react";

import {
  CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
  CAMERA_DETECTION_DEBUGGER_TOKEN_KEY,
  getCameraDetectionDebuggerAuthorizationReturnPath,
} from "~/lib/cameraDetectionDebugger";

// minimal authorization storage boundary
type AuthorizationStorage = Pick<Storage, "setItem">;

const interactiveAuthorizationErrors = new Set([
  "consent_required",
  "interaction_required",
  "login_required",
  "missing_refresh_token",
]);

// identify errors that require user interaction
const requiresInteractiveAuthorization = (error: unknown): boolean => {
  const errorCode =
    typeof error === "object" && error !== null && "error" in error
      ? (error as { error?: unknown }).error
      : null;
  return (
    typeof errorCode === "string" &&
    interactiveAuthorizationErrors.has(errorCode)
  );
};

// injectable browser authorization inputs
interface Props {
  environment?: string;
  navigate?: (path: string) => void;
  recoveryStorage?: AuthorizationStorage;
  search?: string;
  storage?: AuthorizationStorage;
}

// replace the authorization bridge route
const replaceLocation = (path: string): void => window.location.replace(path);

// refresh debugger authorization inside the authenticated app
export const CameraDetectionDebuggerAuthorization = ({
  environment = process.env.NODE_ENV,
  navigate = replaceLocation,
  recoveryStorage = window.sessionStorage,
  search = window.location.search,
  storage = window.sessionStorage,
}: Props): null => {
  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
  } = useAuth0();
  const authorizationStarted = useRef(false);

  // watch the app authorization route
  useEffect(() => {
    const returnPath =
      getCameraDetectionDebuggerAuthorizationReturnPath(search);
    // development recovery guard
    if (
      environment !== "development" ||
      !returnPath ||
      isLoading ||
      authorizationStarted.current
    ) {
      return;
    }
    authorizationStarted.current = true;

    // complete one debugger authorization handoff
    const authorizeDebugger = async (): Promise<void> => {
      // interactive login fallback
      if (!isAuthenticated) {
        await loginWithRedirect({
          appState: { redirectPath: `${window.location.pathname}${search}` },
        });
        return;
      }
      try {
        const accessToken = await getAccessTokenSilently({ cacheMode: "off" });
        storage.setItem(CAMERA_DETECTION_DEBUGGER_TOKEN_KEY, accessToken);
        recoveryStorage.setItem(
          CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
          "true"
        );
        navigate(returnPath);
      } catch (error) {
        // interactive recovery guard
        if (requiresInteractiveAuthorization(error)) {
          await loginWithRedirect({
            appState: { redirectPath: `${window.location.pathname}${search}` },
          });
          return;
        }
        console.error("Camera detector silent authorization failed", error);
      }
    };

    authorizeDebugger().catch((error) =>
      console.error("Camera detector authorization recovery failed", error)
    );
  }, [
    environment,
    getAccessTokenSilently,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    navigate,
    recoveryStorage,
    search,
    storage,
  ]);

  return null;
};
