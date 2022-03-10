import { Helmet } from "react-helmet";
import { Page } from "../components/Page";
import { Splash } from "~/components/Splash";
import { useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";
import React, { ReactElement } from "react";

export const Account = withAuthenticationRequired(
  (): ReactElement => {
    const { user, logout } = useAuth0();

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
            onClick={() => logout({ returnTo: window.location.origin })}
          >
            Log Out
          </button>
        </div>
      </Page>
    );
  },
  { onRedirecting: () => <Splash /> }
);
