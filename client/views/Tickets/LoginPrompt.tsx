import { useAuth0 } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import clsx from "clsx";
import React, { ReactElement } from "react";
import { useLocation } from "react-router-dom";

import { useDevice } from "~/lib/device";

export const LoginPrompt = (): ReactElement | null => {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const device = useDevice();
  const location = useLocation();

  // login route
  const login = async () => {
    // native browser login
    if (device?.isNativeMobile) {
      await loginWithRedirect({
        appState: { redirectPath: location.pathname },
        authorizationParams: {
          redirect_uri: process.env.AUTH0_CLIENT_REDIRECT,
        },
        openUrl: async (url) => {
          await Browser.open({ url });
        },
      });
    } else {
      loginWithRedirect({
        appState: { redirectPath: location.pathname },
        authorizationParams: {
          redirect_uri: process.env.AUTH0_CLIENT_REDIRECT,
        },
      });
    }
  };

  if (isAuthenticated) {
    return null;
  }
  return (
    <li
      className={clsx(
        "my-4 w-full",
        "text-center font-bold",
        "p-4 rounded cursor-pointer",
        "bg-blue-medium dark:bg-blue-light",
        "outline outline-blue-dark dark:outline-blue-medium",
        "text-black"
      )}
      onClick={() => login()}
    >
      Create a free account to save tickets
    </li>
  );
};
