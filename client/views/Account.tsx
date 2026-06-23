import { useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { pluralize } from "shared/lib/strings";

import { Page } from "~/components/Page";
import { Splash } from "~/components/Splash";
import { useDevice } from "~/lib/device";
import { useUser } from "~/lib/user";

interface DetailRowProps {
  label: string;
  value?: ReactNode;
}

// account detail row
const DetailRow = ({ label, value }: DetailRowProps): ReactElement | null => {
  // empty value guard
  if (!value) {
    return null;
  }
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-4 border-b border-gray-200 py-3 last:border-b-0 dark:border-gray-dark">
      <dt className="font-medium text-gray-dark dark:text-gray-medium">
        {label}
      </dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
};

// string claim helper
const getStringClaim = (
  user: Record<string, unknown> | undefined,
  key: string
): string | null => {
  const value = user?.[key];
  // string claim guard
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value;
};

// provider label helper
const getProviderLabel = (sub?: string | null): string | null => {
  // missing subject guard
  if (!sub) {
    return null;
  }
  const [provider] = sub.split("|");
  const labels: Record<string, string> = {
    auth0: "Email and password",
    "google-oauth2": "Google",
    facebook: "Facebook",
    apple: "Apple",
  };
  return labels[provider] ?? provider;
};

// date label helper
const getDateLabel = (value?: string | null): string | null => {
  // missing date guard
  if (!value) {
    return null;
  }
  const date = DateTime.fromISO(value);
  // invalid date guard
  if (!date.isValid) {
    return null;
  }
  return date.toLocaleString(DateTime.DATETIME_MED);
};

export const Account = withAuthenticationRequired(
  (): ReactElement => {
    const { user, logout } = useAuth0();
    const [{ subscribedTerminals, tickets }] = useUser();
    const device = useDevice();
    const userClaims = user as Record<string, unknown> | undefined;
    const name =
      getStringClaim(userClaims, "name") ??
      getStringClaim(userClaims, "nickname") ??
      getStringClaim(userClaims, "email") ??
      "Ferry FYI account";
    const email = getStringClaim(userClaims, "email");
    const nickname = getStringClaim(userClaims, "nickname");
    const username = getStringClaim(userClaims, "preferred_username");
    const locale = getStringClaim(userClaims, "locale");
    const updatedAt = getDateLabel(getStringClaim(userClaims, "updated_at"));
    const subject = getStringClaim(userClaims, "sub");
    const provider = getProviderLabel(subject);
    const accountId = email ?? subject;

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
      <Page title="Account">
        <Helmet>
          <title>Account - Ferry FYI</title>
          <link rel="canonical" href={`${process.env.BASE_URL}/account`} />
        </Helmet>
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
          <section className="rounded bg-white p-6 shadow dark:bg-black">
            <h3 className="mb-3 text-xl font-bold">Profile</h3>
            <dl>
              <DetailRow label="Name" value={name} />
              <DetailRow label="Email" value={email} />
              <DetailRow label="ID" value={accountId} />
              <DetailRow label="Nickname" value={nickname} />
              <DetailRow label="Username" value={username} />
              <DetailRow label="Language" value={locale} />
              <DetailRow label="Logged in with" value={provider} />
              <DetailRow label="Updated" value={updatedAt} />
            </dl>
          </section>

          <section className="rounded bg-white p-6 shadow dark:bg-black">
            <h3 className="mb-3 text-xl font-bold">Ferry FYI</h3>
            <dl>
              <DetailRow
                label="Alerts"
                value={pluralize(subscribedTerminals?.length ?? 0, "terminal")}
              />
              <DetailRow
                label="Tickets"
                value={pluralize(tickets?.length ?? 0, "saved ticket")}
              />
            </dl>
          </section>

          <button
            className="button button-invert mb-8 self-center"
            onClick={() => onLogout()}
          >
            Log Out
          </button>
        </main>
      </Page>
    );
  },
  { onRedirecting: () => <Splash /> }
);
