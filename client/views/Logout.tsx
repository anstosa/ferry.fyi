import { useAuth0 } from "@auth0/auth0-react";
import React, {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Navigate } from "react-router-dom";

import { Splash } from "~/components/Splash";
import { clearCameraDetectionDebuggerAuthorization } from "~/lib/cameraDetectionDebugger";
import { disableAutomaticLeaderboardAccount } from "~/lib/leaderboardAutomatic";

type LogoutState = "complete" | "failed" | "running";

// forced local logout route
export const Logout = (): ReactElement => {
  const { getAccessTokenSilently, logout, user } = useAuth0();
  const [state, setState] = useState<LogoutState>("running");
  const hasStartedRef = useRef(false);
  // track the current cleanup owner across asynchronous auth changes
  const subjectRef = useRef<string | null>(user?.sub ?? null);
  subjectRef.current = user?.sub ?? null;

  // local logout attempt
  const runLogout = useCallback(async (): Promise<void> => {
    setState("running");
    try {
      await disableAutomaticLeaderboardAccount(
        "identity_lost",
        subjectRef.current ?? "",
        // recheck the active auth owner at every teardown boundary
        () => subjectRef.current,
        getAccessTokenSilently
      );
      clearCameraDetectionDebuggerAuthorization();
      await logout({ openUrl: false });
      setState("complete");
    } catch (error) {
      // logout failure report
      console.error("Local logout failed", error);
      setState("failed");
    }
  }, [getAccessTokenSilently, logout]);

  // clear local authentication
  useEffect(() => {
    // duplicate effect guard
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;
    runLogout();
  }, [runLogout]);

  // completed redirect
  if (state === "complete") {
    return <Navigate replace to="/" />;
  }
  // retry state
  if (state === "failed") {
    return (
      <Splash>
        <div className="text-center">
          <p role="alert">Ferry FYI could not clear the local session.</p>
          <button
            className="button button-primary mt-4"
            // retry the complete teardown
            onClick={runLogout}
            type="button"
          >
            Try logout again
          </button>
        </div>
      </Splash>
    );
  }
  return <Splash>Logging out…</Splash>;
};
