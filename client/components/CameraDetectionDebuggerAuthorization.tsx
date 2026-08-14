import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useRef } from "react";

import {
  CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
  CAMERA_DETECTION_DEBUGGER_TOKEN_KEY,
  getCameraDetectionDebuggerAuthorizationReturnPath,
} from "~/lib/cameraDetectionDebugger";

// minimal authorization storage boundary
type AuthorizationStorage = Pick<Storage, "setItem">;

// injectable browser authorization inputs
interface Props {
  environment?: string;
  navigate?: (path: string) => void;
  search?: string;
  storage?: AuthorizationStorage;
}

// replace the authorization bridge route
const replaceLocation = (path: string): void => window.location.replace(path);

// refresh debugger authorization inside the authenticated app
export const CameraDetectionDebuggerAuthorization = ({
  environment = process.env.NODE_ENV,
  navigate = replaceLocation,
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
        storage.setItem(
          CAMERA_DETECTION_DEBUGGER_AUTHORIZATION_REFRESHED_KEY,
          "true"
        );
        navigate(returnPath);
      } catch {
        // expired browser session fallback
        await loginWithRedirect({
          appState: { redirectPath: `${window.location.pathname}${search}` },
        });
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
    search,
    storage,
  ]);

  return null;
};
