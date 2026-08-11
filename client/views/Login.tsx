import { useAuth0 } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import React, { ReactElement, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AUTH0_DATABASE_CONNECTION } from "shared/contracts/iosMigration";
import { getSeoMetadata } from "shared/lib/seo";

import { AuthPageShell } from "~/components/AuthPageShell";
import { SeoHelmet } from "~/components/SeoHelmet";
import { getConfiguredAuth0RedirectUri } from "~/lib/auth";
import { useAppRenderContext } from "~/lib/renderContext";

/** Presents the password-only login supported by the iOS Auth0 client. */
export const Login = (): ReactElement => {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const { platform } = useAppRenderContext();
  const [error, setError] = useState<string>();

  // password login action
  const logIn = async (): Promise<void> => {
    setError(undefined);
    try {
      const options = {
        appState: { redirectPath: "/account" },
        authorizationParams: {
          connection: AUTH0_DATABASE_CONNECTION,
          redirect_uri: getConfiguredAuth0RedirectUri(platform),
        },
      };
      // native auth browser
      if (platform === "ios") {
        await loginWithRedirect({
          ...options,
          // browser launcher
          openUrl: async (url) => {
            await Browser.open({ url });
          },
        });
        return;
      }
      await loginWithRedirect(options);
    } catch {
      setError("We could not open secure login. Please try again.");
    }
  };

  // authenticated route guard
  if (!isLoading && isAuthenticated) {
    return <Navigate replace to="/account" />;
  }

  return (
    <>
      <SeoHelmet seo={getSeoMetadata("/login")} />
      <AuthPageShell title="Welcome back!" titleId="login-title">
        {error && (
          <p
            className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"
            role="alert"
          >
            {error}
          </p>
        )}
        <button
          className="button button-primary mt-7 h-14 w-full text-base shadow-lg"
          disabled={isLoading}
          onClick={logIn}
          type="button"
        >
          Continue with password
        </button>
        <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm font-semibold leading-relaxed text-blue-darkest dark:bg-white/10 dark:text-gray-light">
          <p>
            If you previously signed in with Google,{" "}
            <Link
              className="font-black text-green-dark underline decoration-2 underline-offset-2 hover:text-green-light dark:text-green-light"
              to="/ios"
            >
              add a password to your account on the website first
            </Link>
            .
          </p>
        </div>
      </AuthPageShell>
    </>
  );
};
