import { useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import type { AlertSubscriptionChannel } from "shared/contracts/user";
import { getAlertSubscriptionChannelLabel } from "shared/lib/alertSubscriptions";
import { pluralize } from "shared/lib/strings";

import { Page } from "~/components/Page";
import { Splash } from "~/components/Splash";
import { useDevice } from "~/lib/device";
import { getSlug, useTerminals } from "~/lib/terminals";
import { useUser } from "~/lib/user";

interface DetailRowProps {
  label: string;
  value?: ReactNode;
}

interface SubscriptionSummary {
  channels: AlertSubscriptionChannel[];
  label: string;
  path: string;
  routeKey: string;
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

// route subscription summaries
const getSubscriptionSummaries = (
  alertSubscriptions: Record<string, AlertSubscriptionChannel[]> | undefined,
  terminals: ReturnType<typeof useTerminals>["terminals"]
): SubscriptionSummary[] => {
  // empty subscriptions guard
  if (!alertSubscriptions) {
    return [];
  }
  return Object.entries(alertSubscriptions)
    .map(([routeKey, channels]) => {
      const [firstTerminalId, secondTerminalId] = routeKey.split(":");
      const firstTerminal = terminals.find(({ id }) => id === firstTerminalId);
      const secondTerminal = terminals.find(
        ({ id }) => id === secondTerminalId
      );
      // route data guard
      if (!firstTerminal || !secondTerminal || channels.length === 0) {
        return null;
      }
      return {
        channels,
        label: `${firstTerminal.name} / ${secondTerminal.name}`,
        path: `/${getSlug(firstTerminal.id)}/${getSlug(secondTerminal.id)}/subscribe`,
        routeKey,
      };
    })
    .filter((summary): summary is SubscriptionSummary => {
      return Boolean(summary);
    });
};

export const Account = withAuthenticationRequired(
  (): ReactElement => {
    const { user, logout } = useAuth0();
    const [{ alertSubscriptions, subscribedTerminals, tickets }] = useUser();
    const device = useDevice();
    const { terminals } = useTerminals();
    const subscriptionSummaries = getSubscriptionSummaries(
      alertSubscriptions,
      terminals
    );
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
                value={pluralize(
                  subscriptionSummaries.length,
                  "route subscription"
                )}
              />
              <DetailRow
                label="Tickets"
                value={pluralize(tickets?.length ?? 0, "saved ticket")}
              />
            </dl>
          </section>

          <section
            className="rounded bg-white p-6 shadow dark:bg-black"
            id="subscriptions"
          >
            <h3 className="mb-3 text-xl font-bold">Alert subscriptions</h3>
            {subscriptionSummaries.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {subscriptionSummaries.map(
                  ({ channels, label, path, routeKey }) => (
                    <li key={routeKey}>
                      <Link
                        className="block rounded-xl border border-gray-200 p-3 no-underline transition hover:border-blue-dark hover:bg-blue-dark/5 dark:border-gray-dark dark:hover:border-[#6fb8c8] dark:hover:bg-white/[0.04]"
                        to={path}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-blue-dark dark:text-[#6fb8c8]">
                            {label}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {channels.map((channel) => (
                            <span
                              className="rounded-full bg-green-dark/10 px-2.5 py-1 text-xs font-bold text-green-dark dark:bg-green-light/10 dark:text-green-light"
                              key={channel}
                            >
                              {getAlertSubscriptionChannelLabel(channel)}
                            </span>
                          ))}
                        </div>
                      </Link>
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="text-sm text-gray-dark dark:text-gray-medium">
                You are not subscribed to any route alert channels yet.
              </p>
            )}
            {(subscribedTerminals?.length ?? 0) > 0 && (
              <p className="mt-4 rounded-xl bg-day-normal-light p-3 text-sm text-gray-dark dark:bg-blue-dark dark:text-[#b8d5de]">
                You also have legacy all-alert subscriptions for{" "}
                {pluralize(subscribedTerminals?.length ?? 0, "terminal")}.
                Editing a route subscription will move that route to channel
                controls.
              </p>
            )}
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
