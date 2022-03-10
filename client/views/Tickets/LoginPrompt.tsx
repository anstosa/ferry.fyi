import { Browser } from "@capacitor/browser";
import { useAuth0 } from "@auth0/auth0-react";
import { useDevice } from "~/lib/device";
import { useLocation } from "react-router-dom";
import clsx from "clsx";
import React, { ReactElement } from "react";

export const LoginPrompt = (): ReactElement | null => {
  const { isAuthenticated, loginWithRedirect, buildAuthorizeUrl } = useAuth0();
  const device = useDevice();
  const location = useLocation();

  const login = async () => {
    if (device?.isNativeMobile) {
      const url = await buildAuthorizeUrl();
      await Browser.open({ url });
    } else {
      loginWithRedirect({
        appState: { redirectPath: location.pathname },
        redirectUri: process.env.AUTH0_CLIENT_REDIRECT,
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
