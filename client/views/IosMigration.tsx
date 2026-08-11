import { useAuth0 } from "@auth0/auth0-react";
import React, { FormEvent, ReactElement, useEffect, useState } from "react";
import {
  AUTH0_DATABASE_CONNECTION,
  AUTH0_GOOGLE_CONNECTION,
  type IosMigrationLinkResponse,
  type IosMigrationStatus,
  type IosMigrationVerificationEmailResponse,
} from "shared/contracts/iosMigration";
import { getSeoMetadata } from "shared/lib/seo";

import { AuthPageShell } from "~/components/AuthPageShell";
import { SeoHelmet } from "~/components/SeoHelmet";
import { ApiError, get, post } from "~/lib/api";
import {
  createAuth0DatabaseAccount,
  openWebIosMigration,
} from "~/lib/iosMigration";
import { useAppRenderContext } from "~/lib/renderContext";

type MigrationStep = "creating" | "password" | "verify";
type DatabaseSignupState = "created" | "exists";
type VerificationEmailState = "idle" | "sending" | "sent";

// auth0 signup detail
const getPasswordCreationError = (caught: unknown): string =>
  caught instanceof Error && caught.message
    ? caught.message
    : "Auth0 could not create that login. Please try again.";

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
  const [databaseSignupState, setDatabaseSignupState] =
    useState<DatabaseSignupState>();
  const [verificationEmailState, setVerificationEmailState] =
    useState<VerificationEmailState>("idle");

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

  // verification email request
  const sendVerificationEmail = async (): Promise<void> => {
    setError(undefined);
    setVerificationEmailState("sending");
    try {
      const accessToken = await getAccessTokenSilently();
      await post<IosMigrationVerificationEmailResponse>(
        "/ios-migration/verification-email",
        {},
        accessToken
      );
      setVerificationEmailState("sent");
    } catch {
      setVerificationEmailState("idle");
      setError(
        "Your password login exists, but Ferry FYI could not send its verification email. Try resending it."
      );
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
      const signupState = await createAuth0DatabaseAccount({
        email: status.email,
        password,
      });
      setDatabaseSignupState(signupState);
      setPassword("");
      setPasswordConfirmation("");
      setStep("verify");
      await sendVerificationEmail();
    } catch (caught) {
      setStep("password");
      setError(getPasswordCreationError(caught));
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
    } catch (caught) {
      // verification guidance
      if (caught instanceof ApiError && caught.status === 409) {
        setError(
          "That email is not verified yet. Open the verification email or resend it below, then try again."
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
      className="button button-primary mt-7 h-14 w-full text-base shadow-lg"
      onClick={startMigration}
      type="button"
    >
      {platform === "ios" ? "Open secure migration" : "Continue with Google"}
    </button>
  );

  return (
    <>
      <SeoHelmet seo={getSeoMetadata("/ios")} />
      <AuthPageShell
        description="Login with Google, add a username and password. Your saved routes, tickets, and alerts stay with you."
        title="Make your Ferry FYI account iOS compatible"
        titleId="ios-title"
      >
        {error && (
          <p
            className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"
            role="alert"
          >
            {error}
          </p>
        )}

        {platform === "ios" && (
          <>
            <p className="mt-6 text-sm font-semibold leading-relaxed text-gray-dark dark:text-gray-light">
              This step uses Ferry FYI&apos;s web login because Google is not
              offered by the iOS app.
            </p>
            {entry}
          </>
        )}

        {platform !== "ios" && (isLoading || (isAuthenticated && !status)) && (
          <div
            className="mt-7 flex items-center justify-center gap-3 rounded-2xl bg-green-50 p-4 font-bold text-green-dark dark:bg-white/10 dark:text-green-light"
            aria-live="polite"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-pulse rounded-full bg-green-light"
            />
            Checking your account…
          </div>
        )}

        {platform !== "ios" && !isLoading && !isAuthenticated && entry}

        {platform !== "ios" && status?.state === "unsupported" && (
          <>
            <p className="mt-6 text-sm font-semibold leading-relaxed text-gray-dark dark:text-gray-light">
              Continue with the Google account that owns your existing Ferry FYI
              data.
            </p>
            {entry}
          </>
        )}

        {platform !== "ios" &&
          status?.state === "eligible" &&
          step !== "verify" && (
            <form className="mt-7 text-left" onSubmit={createPasswordIdentity}>
              <p className="mb-5 text-center font-semibold">
                Create a password login for <strong>{status.email}</strong>.
              </p>
              <label
                className="block text-sm font-black"
                htmlFor="ios-password"
              >
                New password
              </label>
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-2xl border border-gray-300 bg-white p-3.5 text-gray-900 shadow-inner outline-none transition focus:border-green-light focus:ring-4 focus:ring-green-light/20"
                disabled={step === "creating"}
                id="ios-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <label
                className="mt-5 block text-sm font-black"
                htmlFor="ios-password-confirmation"
              >
                Confirm password
              </label>
              <input
                autoComplete="new-password"
                className="mt-2 w-full rounded-2xl border border-gray-300 bg-white p-3.5 text-gray-900 shadow-inner outline-none transition focus:border-green-light focus:ring-4 focus:ring-green-light/20"
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
                className="button button-primary mt-7 h-14 w-full text-base shadow-lg"
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
            <div className="mt-7 rounded-2xl bg-green-50 p-5 dark:bg-white/10">
              <h2 className="text-xl font-black">Finish account migration</h2>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-gray-dark dark:text-gray-light">
                {verificationEmailState === "sent" &&
                  databaseSignupState === "created" &&
                  `We sent a verification email to ${status.email}. Open it, return here, then authenticate with the password you just created.`}
                {verificationEmailState === "sent" &&
                  databaseSignupState === "exists" &&
                  `A password login already exists for ${status.email}. Open the verification email if needed, then authenticate with its existing password or use Forgot password.`}
                {verificationEmailState === "sending" &&
                  `Sending a verification email to ${status.email}…`}
                {verificationEmailState === "idle" &&
                  "Send a verification email before authenticating with the password login."}
              </p>
              <button
                className="button button-secondary mt-5 w-full"
                disabled={verificationEmailState === "sending"}
                onClick={sendVerificationEmail}
                type="button"
              >
                {verificationEmailState === "sending"
                  ? "Sending verification email…"
                  : "Resend verification email"}
              </button>
              <button
                className="button button-primary mt-6 h-14 w-full text-base shadow-lg"
                disabled={verificationEmailState !== "sent"}
                onClick={verifyAndLink}
                type="button"
              >
                Authenticate with password and finish
              </button>
            </div>
          )}

        {platform !== "ios" && status?.state === "complete" && (
          <div
            className="mt-7 rounded-2xl border border-green-200 bg-green-50 p-5 font-semibold text-green-900"
            role="status"
          >
            Your email and password login is connected. You can now return to
            the iOS app and sign in with it.
          </div>
        )}
      </AuthPageShell>
    </>
  );
};
