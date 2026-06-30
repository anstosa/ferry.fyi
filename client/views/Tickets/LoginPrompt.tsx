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
    <li>
      <button
        className={clsx(
          "group flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left shadow-sm",
          "border-blue-light bg-blue-lightest text-blue-dark hover:-translate-y-0.5 hover:shadow-lg",
          "dark:border-white/10 dark:bg-white/10 dark:text-blue-light"
        )}
        onClick={() => login()}
        type="button"
      >
        <span>
          <span className="block text-base font-black">
            Create a free account
          </span>
          <span className="mt-1 block text-sm font-semibold text-gray-dark dark:text-white/65">
            Sync saved tickets across devices
          </span>
        </span>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-blue-dark dark:bg-blue-light dark:text-blue-darkest">
          Sync
        </span>
      </button>
    </li>
  );
};
