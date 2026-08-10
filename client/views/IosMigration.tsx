import { useAuth0 } from "@auth0/auth0-react";
import React, { FormEvent, ReactElement, useEffect, useState } from "react";
import {
  AUTH0_DATABASE_CONNECTION,
  AUTH0_GOOGLE_CONNECTION,
  type IosMigrationLinkResponse,
  type IosMigrationStatus,
} from "shared/contracts/iosMigration";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import { ApiError, get, post } from "~/lib/api";
import {
  createAuth0DatabaseAccount,
  openWebIosMigration,
} from "~/lib/iosMigration";
import { useAppRenderContext } from "~/lib/renderContext";

type MigrationStep = "creating" | "password" | "verify";

// canonical web migration url
const getWebMigrationUrl = (): string => {
  const baseUrl = process.env.BASE_URL || "https://ferry.fyi";
  try {
    return new URL("/ios", baseUrl).toString();
  } catch {
    // relative build base fallback
    return "https://ferry.fyi/ios";
  }
};

// secure ios account migration
export const IosMigration = (): ReactElement => {
  const {
    getAccessTokenSilently,
    getAccessTokenWithPopup,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
  } = useAuth0();
  const { platform } = useAppRenderContext();
  const [status, setStatus] = useState<IosMigrationStatus>();
  const [step, setStep] = useState<MigrationStep>("password");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string>();

  // load authenticated migration state
  useEffect(() => {
    let cancelled = false;
    // authenticated web guard
    if (!isAuthenticated || platform === "ios") {
      setStatus(undefined);
      return () => {
        cancelled = true;
      };
    }
    // status loader
    const loadStatus = async (): Promise<void> => {
      try {
        const accessToken = await getAccessTokenSilently();
        const result = await get<IosMigrationStatus>(
          "/ios-migration/status",
          accessToken
        );
        // stale request guard
        if (!cancelled) {
          setStatus(result);
          setError(undefined);
        }
      } catch {
        // stale request guard
        if (!cancelled) {
          setError("We could not verify this account. Please try again.");
        }
      }
    };
    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [getAccessTokenSilently, isAuthenticated, platform]);

  // forced google login
  const authenticateGoogle = async (): Promise<void> => {
    setError(undefined);
    await loginWithRedirect({
      appState: { redirectPath: "/ios" },
      authorizationParams: {
        connection: AUTH0_GOOGLE_CONNECTION,
        max_age: 0,
        prompt: "login",
      },
    });
  };

  // entry action
  const startMigration = async (): Promise<void> => {
    try {
      // native client guard
      if (platform === "ios") {
        await openWebIosMigration(getWebMigrationUrl());
        return;
      }
      await authenticateGoogle();
    } catch {
      setError("We could not open secure account migration. Please try again.");
    }
  };

  // password submission
  const createPasswordIdentity = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    // password match guard
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }
    // password presence guard
    if (!password) {
      setError("Enter a password.");
      return;
    }
    // eligible profile guard
    if (status?.state !== "eligible") {
      setError("Authenticate with your existing Google account first.");
      return;
    }
    setStep("creating");
    try {
      await createAuth0DatabaseAccount({ email: status.email, password });
      setPassword("");
      setPasswordConfirmation("");
      setStep("verify");
    } catch {
      setStep("password");
      setError(
        "Auth0 rejected that password. Use a stronger password and try again."
      );
    }
  };

  // secondary authentication
  const verifyAndLink = async (): Promise<void> => {
    setError(undefined);
    // eligible profile guard
    if (status?.state !== "eligible") {
      setError("Authenticate with your existing Google account first.");
      return;
    }
    try {
      const primaryAccessToken = await getAccessTokenSilently();
      const secondaryAccessToken = await getAccessTokenWithPopup({
        authorizationParams: {
          audience: process.env.AUTH0_CLIENT_AUDIENCE,
          connection: AUTH0_DATABASE_CONNECTION,
          login_hint: status.email,
          max_age: 0,
          prompt: "login",
          scope: "openid profile email read:current_user offline_access",
        },
      });
      // popup token guard
      if (!secondaryAccessToken) {
        throw new Error("Auth0 did not return an access token");
      }
      await post<IosMigrationLinkResponse>(
        "/ios-migration/link",
        { secondaryAccessToken },
        primaryAccessToken
      );
      setStatus({ email: status.email, state: "complete" });
      await authenticateGoogle();
    } catch (caught) {
      // verification guidance
      if (caught instanceof ApiError && caught.status === 409) {
        setError(
          "Verify the new account email, then authenticate with the new password again."
        );
        return;
      }
      setError(
        "The password identity could not be verified and linked. Please try again."
      );
    }
  };

  const entry = (
    <button
      className="button button-primary mt-6 w-full"
      onClick={startMigration}
    >
      {platform === "ios" ? "Open secure migration" : "Continue with Google"}
    </button>
  );

  return (
    <Page title="Move your account to iOS">
      <SeoHelmet seo={getSeoMetadata("/ios")} />
      <section className="mx-auto max-w-xl py-6" aria-labelledby="ios-title">
        <h2 id="ios-title" className="text-2xl font-bold">
          Keep your Ferry FYI account on iOS
        </h2>
        <p className="mt-3">
          Authenticate your existing Google account, create an email and
          password login, then verify both identities. Your saved Ferry FYI data
          stays attached to the existing account.
        </p>

        {error && (
          <p className="mt-4 rounded bg-red-100 p-3 text-red-900" role="alert">
            {error}
          </p>
        )}

        {platform === "ios" && (
          <>
            <p className="mt-4">
              This step uses Ferry FYI&apos;s web login because Google is not
              offered by the iOS app.
            </p>
            {entry}
          </>
        )}

        {platform !== "ios" && (isLoading || (isAuthenticated && !status)) && (
          <p className="mt-6" aria-live="polite">
            Checking your account…
          </p>
        )}

        {platform !== "ios" && !isLoading && !isAuthenticated && entry}

        {platform !== "ios" && status?.state === "unsupported" && (
          <>
            <p className="mt-4">
              Continue with the Google account that owns your existing Ferry FYI
              data.
            </p>
            {entry}
          </>
        )}

        {platform !== "ios" &&
          status?.state === "eligible" &&
          step !== "verify" && (
            <form className="mt-6" onSubmit={createPasswordIdentity}>
              <p className="mb-4">
                Create a password login for <strong>{status.email}</strong>.
              </p>
              <label className="block font-bold" htmlFor="ios-password">
                New password
              </label>
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-gray-400 bg-white p-3 text-gray-900"
                disabled={step === "creating"}
                id="ios-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <label
                className="mt-4 block font-bold"
                htmlFor="ios-password-confirmation"
              >
                Confirm password
              </label>
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-gray-400 bg-white p-3 text-gray-900"
                disabled={step === "creating"}
                id="ios-password-confirmation"
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
                required
                type="password"
                value={passwordConfirmation}
              />
              <button
                className="button button-primary mt-6 w-full"
                disabled={step === "creating"}
                type="submit"
              >
                {step === "creating"
                  ? "Creating login…"
                  : "Create password login"}
              </button>
            </form>
          )}

        {platform !== "ios" &&
          status?.state === "eligible" &&
          step === "verify" && (
            <div className="mt-6">
              <h3 className="text-lg font-bold">Verify the new login</h3>
              <p className="mt-2">
                If Auth0 sent a verification email, open it first. Then
                authenticate once with the password you just created.
              </p>
              <button
                className="button button-primary mt-6 w-full"
                onClick={verifyAndLink}
              >
                Verify password and finish
              </button>
            </div>
          )}

        {platform !== "ios" && status?.state === "complete" && (
          <div
            className="mt-6 rounded bg-green-100 p-4 text-green-900"
            role="status"
          >
            Your email and password login is connected. You can now return to
            the iOS app and sign in with it.
          </div>
        )}
      </section>
    </Page>
  );
};
