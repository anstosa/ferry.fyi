import { useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  AlertRule,
  AlertSubscriptionChannel,
} from "shared/contracts/user";
import {
  EVERY_DAY_DAYS,
  getAlertSubscriptionChannelLabel,
  isFullDayAlertRule,
  isOneTimeAlertRule,
  normalizeAlertRuleDays,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
} from "shared/lib/alertSubscriptions";
import { getSeoMetadata } from "shared/lib/seo";
import { pluralize } from "shared/lib/strings";

import { NotificationPermissionWarning } from "~/components/NotificationPermissionWarning";
import { Page } from "~/components/Page";
import { PageLoadError } from "~/components/PageLoadError";
import { SeoHelmet } from "~/components/SeoHelmet";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { getConfiguredAuth0RedirectUri } from "~/lib/auth";
import { useDevice } from "~/lib/device";
import { getSlug, useTerminals } from "~/lib/terminals";
import { type ThemePreference, useThemePreference } from "~/lib/theme";
import { useUser } from "~/lib/user";
import {
  getReservationAccountCount,
  ticketsAtom,
} from "~/views/Tickets/storage";

interface DetailRowProps {
  label: string;
  value?: ReactNode;
}

interface SubscriptionSummary {
  channels: AlertSubscriptionChannel[];
  detail: string;
  label: string;
  path: string;
  routeKey: string;
  typeLabel: string;
}

interface TicketSummaryCounts {
  reservationAccountCount: number;
  savedTicketCount: number;
}

const THEME_OPTIONS: Array<{
  description: string;
  label: string;
  value: ThemePreference;
}> = [
  {
    description: "Match your device",
    label: "System",
    value: "system",
  },
  {
    description: "Always use light mode",
    label: "Light",
    value: "light",
  },
  {
    description: "Always use dark mode",
    label: "Dark",
    value: "dark",
  },
];

// day list key
const getDayKey = (daysOfWeek: number[]): string => {
  return normalizeAlertRuleDays(daysOfWeek).join(":");
};

// day summary
const getDaysSummary = (daysOfWeek: number[]): string => {
  const dayKey = getDayKey(daysOfWeek);
  // every day guard
  if (dayKey === EVERY_DAY_DAYS.join(":")) {
    return "Every day";
  }
  // weekday guard
  if (dayKey === WEEKDAY_DAYS.join(":")) {
    return "Weekdays";
  }
  // weekend guard
  if (dayKey === WEEKEND_DAYS.join(":")) {
    return "Weekends";
  }
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return normalizeAlertRuleDays(daysOfWeek)
    .map((day) => labels[day - 1])
    .join(", ");
};

// channel summary
const getChannelSummary = (channels: AlertSubscriptionChannel[]): string => {
  return channels.map(getAlertSubscriptionChannelLabel).join(", ");
};

// sailing date label
const getSailingDateLabel = (date: string): string => {
  return DateTime.fromISO(date).toFormat("LLL d");
};

// sailing time label
const getSailingTimeLabel = (time: string): string => {
  return DateTime.fromFormat(time, "HH:mm").toFormat("h:mm a");
};

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

// alert rule summaries
const getAlertRuleSummaries = (
  alertRules: AlertRule[] | undefined,
  terminals: ReturnType<typeof useTerminals>["terminals"]
): SubscriptionSummary[] => {
  // empty rules guard
  if (!alertRules) {
    return [];
  }
  return alertRules
    .map((rule) => {
      const [firstTerminalId, secondTerminalId] = rule.routeKey.split(":");
      const firstTerminal = terminals.find(({ id }) => id === firstTerminalId);
      const secondTerminal = terminals.find(
        ({ id }) => id === secondTerminalId
      );
      // route data guard
      if (!firstTerminal || !secondTerminal || rule.channels.length === 0) {
        return null;
      }
      const departingNames = rule.terminalIds
        .map(
          (terminalId) => terminals.find(({ id }) => id === terminalId)?.name
        )
        .filter(Boolean)
        .join(" / ");
      const direction = `From ${departingNames || "route"}`;
      let detail = `${getChannelSummary(rule.channels)} · ${direction}`;
      let path = `/${getSlug(firstTerminal.id)}/${getSlug(secondTerminal.id)}/subscribe`;
      let typeLabel = "Route alerts";
      // full day summary
      if (isFullDayAlertRule(rule)) {
        detail = `${getChannelSummary(rule.channels)} · Any time`;
      }
      // scheduled summary
      if (!isFullDayAlertRule(rule)) {
        detail = [
          getChannelSummary(rule.channels),
          getDaysSummary(rule.daysOfWeek),
          `${getSailingTimeLabel(rule.startTime)}–${getSailingTimeLabel(
            rule.endTime
          )}`,
          direction,
        ].join(" · ");
      }
      // one-time summary
      if (isOneTimeAlertRule(rule)) {
        detail = [
          getChannelSummary(rule.channels),
          `${getSailingDateLabel(rule.date)} at ${getSailingTimeLabel(
            rule.startTime
          )}`,
          direction,
        ].join(" · ");
        path = `/${getSlug(firstTerminal.id)}/${getSlug(
          secondTerminal.id
        )}?date=${rule.date}`;
        typeLabel = "One-time alert";
      }
      return {
        channels: rule.channels,
        detail,
        label: `${firstTerminal.name} / ${secondTerminal.name}`,
        path,
        routeKey: rule.id,
        typeLabel,
      };
    })
    .filter((summary): summary is SubscriptionSummary => {
      return Boolean(summary);
    });
};

// ticket summary text
const getTicketSummary = ({
  reservationAccountCount,
  savedTicketCount,
}: TicketSummaryCounts): string => {
  const parts: string[] = [];

  // saved ticket summary
  if (savedTicketCount > 0) {
    parts.push(pluralize(savedTicketCount, "saved ticket"));
  }

  // reservation account summary
  if (reservationAccountCount > 0) {
    parts.push(pluralize(reservationAccountCount, "reservation account"));
  }

  // empty wallet guard
  if (parts.length === 0) {
    return "No saved tickets or reservation accounts yet.";
  }

  return `${parts.join(" and ")} ready in Tickets.`;
};

export const AccountLoadingState = (): ReactElement => (
  <Page title="Account">
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <SkeletonGroup className="flex flex-col gap-6" label="Loading account">
        <section className="rounded bg-white p-6 shadow dark:bg-black">
          <Skeleton className="h-7 w-24" variant="text" />
          <div className="mt-5 space-y-4">
            <Skeleton className="h-5 w-full" variant="text" />
            <Skeleton className="h-5 w-4/5" variant="text" />
            <Skeleton className="h-5 w-3/5" variant="text" />
          </div>
        </section>
        <section className="rounded bg-white p-6 shadow dark:bg-black">
          <Skeleton className="h-7 w-28" variant="text" />
          <Skeleton className="mt-4 h-4 w-2/5" variant="text" />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>
        <section className="rounded bg-white p-6 shadow dark:bg-black">
          <Skeleton className="h-7 w-20" variant="text" />
          <Skeleton className="mt-4 h-4 w-1/2" variant="text" />
        </section>
      </SkeletonGroup>
    </div>
  </Page>
);

export const Account = withAuthenticationRequired(
  (): ReactElement => {
    const { user: authUser, logout } = useAuth0();
    const [
      { alertRules, isUserLoading, tickets, user: accountUser, userError },
      { refreshUser },
    ] = useUser();
    const device = useDevice();
    const [themePreference, setThemePreference] = useThemePreference();
    const { terminals } = useTerminals();
    const storedTickets = useAtomValue(ticketsAtom);
    const subscriptionSummaries = getAlertRuleSummaries(alertRules, terminals);
    const ticketSummary = getTicketSummary({
      reservationAccountCount: getReservationAccountCount(storedTickets),
      savedTicketCount: tickets?.length ?? 0,
    });
    const userClaims = authUser as Record<string, unknown> | undefined;
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
          logoutParams: { returnTo: getConfiguredAuth0RedirectUri() },
          openUrl: async (url) => {
            await Browser.open({ url });
          },
        });
      } else {
        await logout({
          logoutParams: { returnTo: getConfiguredAuth0RedirectUri() },
        });
      }
    };

    // account sync retry
    const retryAccountSync = (): void => {
      refreshUser().catch((error) => {
        // retry failure
        console.error(error);
      });
    };

    // initial account metadata error
    if (!accountUser && userError) {
      return (
        <Page title="Account">
          <PageLoadError
            error={userError}
            message="Ferry FYI could not reach the account API. Reload and try again, or contact the developer if it keeps happening."
            onReload={retryAccountSync}
            title="Account could not load"
          />
        </Page>
      );
    }

    // initial account metadata loading
    if (!accountUser && isUserLoading) {
      return <AccountLoadingState />;
    }

    return (
      <Page title="Account">
        <SeoHelmet seo={getSeoMetadata("/account")} />
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
          {userError && (
            <section
              className="rounded border border-stale-light bg-stale-light/10 p-4 text-sm text-gray-dark dark:border-[#ffb3b0] dark:text-[#ffb3b0]"
              role="alert"
            >
              <p>
                Account preferences could not be refreshed. Existing account
                details are still available.
              </p>
              <button
                className="link mt-2 font-bold text-blue-dark dark:text-[#6fb8c8]"
                onClick={retryAccountSync}
                type="button"
              >
                Try again
              </button>
            </section>
          )}
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
            <h3 className="text-xl font-bold">Appearance</h3>
            <p className="mt-2 text-sm text-gray-dark dark:text-gray-medium">
              Choose how Ferry FYI looks on this device.
            </p>
            <div
              aria-label="Theme preference"
              className="mt-4 grid gap-3 sm:grid-cols-3"
              role="group"
            >
              {THEME_OPTIONS.map(({ description, label, value }) => {
                const isSelected = themePreference === value;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={clsx(
                      "rounded-xl border px-3 py-3 text-left transition",
                      isSelected
                        ? "border-green-dark bg-green-dark text-white dark:border-green-light dark:bg-green-light dark:text-green-dark"
                        : "border-gray-200 bg-gray-lightest text-gray-dark hover:border-blue-dark hover:bg-blue-dark/5 dark:border-gray-dark dark:bg-white/[0.04] dark:text-gray-light dark:hover:border-[#6fb8c8] dark:hover:bg-white/[0.08]"
                    )}
                    key={value}
                    onClick={() => setThemePreference(value)}
                    type="button"
                  >
                    <span className="block font-bold">{label}</span>
                    <span className="mt-1 block text-xs font-medium opacity-80">
                      {description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded bg-white p-6 shadow dark:bg-black">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold">Tickets</h3>
                <p className="mt-2 text-sm text-gray-dark dark:text-gray-medium">
                  {ticketSummary}
                </p>
              </div>
              <Link
                className="button button-primary no-underline"
                to="/tickets"
              >
                View tickets
              </Link>
            </div>
          </section>

          <section
            className="rounded bg-white p-6 shadow dark:bg-black"
            id="subscriptions"
          >
            <h3 className="mb-3 text-xl font-bold">Alerts</h3>
            <p className="mb-4 text-sm text-gray-dark dark:text-gray-medium">
              {subscriptionSummaries.length > 0
                ? `${pluralize(subscriptionSummaries.length, "saved alert")}.`
                : "You have not saved any alerts yet."}
            </p>
            <NotificationPermissionWarning
              className="mb-4"
              hasAlerts={subscriptionSummaries.length > 0}
            />
            {subscriptionSummaries.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {subscriptionSummaries.map(
                  ({ channels, detail, label, path, routeKey, typeLabel }) => (
                    <li key={routeKey}>
                      <Link
                        className="block rounded-xl border border-gray-200 p-3 no-underline transition hover:border-blue-dark hover:bg-blue-dark/5 dark:border-gray-dark dark:hover:border-[#6fb8c8] dark:hover:bg-white/[0.04]"
                        to={path}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-blue-dark dark:text-[#6fb8c8]">
                            {label}
                          </span>
                          <span className="rounded-full bg-blue-dark/10 px-2.5 py-1 text-2xs font-bold uppercase tracking-wide text-blue-dark dark:bg-[#6fb8c8]/10 dark:text-[#6fb8c8]">
                            {typeLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-dark dark:text-gray-medium">
                          {detail}
                        </p>
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
                Add route alerts from any terminal alerts page, or one-time
                alerts from an expanded sailing.
              </p>
            )}
          </section>

          <button
            className="button button-invert mb-8 self-center"
            onClick={() => onLogout()}
          >
            Log Out
          </button>
        </div>
      </Page>
    );
  },
  { onRedirecting: () => <AccountLoadingState /> }
);
