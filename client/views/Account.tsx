import { useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import React, { ReactElement } from "react";
import { Helmet } from "react-helmet-async";

import { Splash } from "~/components/Splash";
import { useDevice } from "~/lib/device";

import { Page } from "../components/Page";

export const Account = withAuthenticationRequired(
  (): ReactElement => {
    const { user, logout } = useAuth0();
    const device = useDevice();

    // logout route
    const onLogout = async () => {
      // native browser logout
      if (device?.isNativeMobile) {
        await logout({
          logoutParams: { returnTo: process.env.AUTH0_CLIENT_REDIRECT },
          openUrl: async (url) => {
            await Browser.open({ url });
          },
        });
      } else {
        await logout({
          logoutParams: { returnTo: process.env.AUTH0_CLIENT_REDIRECT },
        });
      }
    };

    return (
      <Page>
        <Helmet>
          <link rel="canonical" href={`${process.env.BASE_URL}/account`} />
        </Helmet>
        <div className="flex flex-col items-center gap-4 py-4 min-h-full">
          <img src={user?.picture} className="w-36 rounded-xl" />
          <h1 className="text-3xl font-bold">{user?.name}</h1>
          <span className="italic">({user?.email})</span>
          <div className="flex-grow" />
          <button
            className="button button-invert mb-8"
            onClick={() => onLogout()}
          >
            Log Out
          </button>
        </div>
      </Page>
    );
  },
  { onRedirecting: () => <Splash /> }
);
