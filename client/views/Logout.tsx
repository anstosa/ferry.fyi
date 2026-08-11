import { useAuth0 } from "@auth0/auth0-react";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";

import { Splash } from "~/components/Splash";

// forced local logout route
export const Logout = (): ReactElement => {
  const { logout } = useAuth0();
  const [isComplete, setComplete] = useState(false);
  const hasStartedRef = useRef(false);

  // clear local authentication
  useEffect(() => {
    // duplicate effect guard
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;
    logout({ openUrl: false })
      .catch((error) => {
        // logout failure report
        console.error(error);
      })
      .finally(() => setComplete(true));
  }, [logout]);

  // completed redirect
  if (isComplete) {
    return <Navigate replace to="/" />;
  }
  return <Splash>Logging out…</Splash>;
};
