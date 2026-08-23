import { useAuth0, withAuthenticationRequired } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import React, { type ReactElement, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  type AlertRule,
  type AlertSubscriptionChannel,
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

import { AccountProfileHeader } from "~/components/AccountProfileHeader";
import { NotificationPermissionWarning } from "~/components/NotificationPermissionWarning";
import { Page } from "~/components/Page";
import { PageLoadError } from "~/components/PageLoadError";
import { SeoHelmet } from "~/components/SeoHelmet";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { SupporterCard } from "~/components/SupporterCard";
import { ApiError } from "~/lib/api";
import {
  getConfiguredAuth0RedirectUri,
  getLogoutMode,
  logoutWithAppFlow,
} from "~/lib/auth";
import { clearCameraDetectionDebuggerAuthorization } from "~/lib/cameraDetectionDebugger";
import { useDevice } from "~/lib/device";
import { disableAutomaticLeaderboardAccount } from "~/lib/leaderboardAutomatic";
import { useSupporter } from "~/lib/supporterContext";
import { getSlug, useTerminals } from "~/lib/terminals";
import { type ThemePreference, useThemePreference } from "~/lib/theme";
import { useUser } from "~/lib/user";
import {
  getReservationAccountCount,
  ticketsAtom,
} from "~/views/Tickets/storage";

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

type AccountDeletionState = "closed" | "confirming" | "deleting";

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
        <section className="overflow-hidden rounded-2xl bg-white shadow dark:bg-black">
          <div className="flex flex-col items-stretch gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-start gap-4 sm:items-center">
              <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-6 w-40" variant="text" />
                <Skeleton className="h-4 w-52 max-w-full" variant="text" />
              </div>
            </div>
            <Skeleton className="h-8 w-20 shrink-0 self-end rounded-xl sm:self-auto" />
          </div>
          <div className="grid gap-px bg-gray-200 sm:grid-cols-2 lg:grid-cols-3 dark:bg-gray-dark">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="bg-white px-6 py-4 dark:bg-black" key={index}>
                <Skeleton className="h-3 w-16" variant="text" />
                <Skeleton className="mt-2 h-4 w-28" variant="text" />
              </div>
            ))}
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
    const { getAccessTokenSilently, user: authUser, logout } = useAuth0();
    const [
      { alertRules, isUserLoading, tickets, user: accountUser, userError },
      { deleteAccount, refreshUser },
    ] = useUser();
    const device = useDevice();
    const supporter = useSupporter();
    const navigate = useNavigate();
    const [themePreference, setThemePreference] = useThemePreference();
    const [deletionConfirmation, setDeletionConfirmation] = useState("");
    const [continuingBillingAcknowledged, setContinuingBillingAcknowledged] =
      useState(false);
    const [
      continuingBillingWarningRequired,
      setContinuingBillingWarningRequired,
    ] = useState(false);
    const [deletionError, setDeletionError] = useState<string | null>(null);
    const [deletionState, setDeletionState] =
      useState<AccountDeletionState>("closed");
    const [logoutError, setLogoutError] = useState<string | null>(null);
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
    // track the current cleanup owner across asynchronous auth changes
    const subjectRef = useRef<string | null>(subject ?? null);
    subjectRef.current = subject ?? null;
    const provider = getProviderLabel(subject);
    const accountId = email ?? subject;

    // logout route
    const onLogout = async (): Promise<void> => {
      setLogoutError(null);
      try {
        await disableAutomaticLeaderboardAccount(
          "identity_lost",
          subject ?? "",
          // recheck the active auth owner at every teardown boundary
          () => subjectRef.current,
          getAccessTokenSilently
        );
      } catch (error) {
        // preserve authentication until local automatic data is purged
        console.error("Local pre-logout cleanup failed", error);
        setLogoutError(
          "Ferry FYI could not clear automatic check-in data. Retry logout before changing accounts."
        );
        return;
      }
      clearCameraDetectionDebuggerAuthorization();
      const options = {
        logoutParams: { returnTo: getConfiguredAuth0RedirectUri() },
      };
      const mode = getLogoutMode(Boolean(device?.isNativeMobile));
      try {
        // framed browser local logout
        if (mode === "iframe") {
          await logoutWithAppFlow({
            // navigate before framed auth teardown
            beforeLogout: () => navigate("/", { replace: true }),
            framed: true,
            logout,
            options,
          });
          return;
        }
        // native browser logout
        if (mode === "native") {
          await logout({
            ...options,
            // open one reviewed native auth url
            openUrl: async (url) => {
              await Browser.open({ url });
            },
          });
        } else {
          await logoutWithAppFlow({ framed: false, logout, options });
        }
      } catch (error) {
        // report auth teardown separately
        console.error("Logout failed", error);
        setLogoutError("Ferry FYI could not log out. Try again.");
      }
    };

    // account sync retry
    const retryAccountSync = (): void => {
      refreshUser().catch((error) => {
        // retry failure
        console.error(error);
      });
    };

    // open deletion confirmation
    const openDeletion = (): void => {
      setDeletionConfirmation("");
      setContinuingBillingAcknowledged(false);
      setContinuingBillingWarningRequired(false);
      setDeletionError(null);
      setDeletionState("confirming");
    };

    // close deletion confirmation
    const closeDeletion = (): void => {
      setDeletionConfirmation("");
      setContinuingBillingAcknowledged(false);
      setContinuingBillingWarningRequired(false);
      setDeletionError(null);
      setDeletionState("closed");
    };

    // permanently delete account
    const confirmDeletion = async (): Promise<void> => {
      // exact confirmation guard
      if (deletionConfirmation !== ACCOUNT_DELETION_CONFIRMATION) {
        return;
      }
      setDeletionError(null);
      setDeletionState("deleting");
      try {
        await disableAutomaticLeaderboardAccount(
          "account_deleted",
          subject ?? "",
          // recheck the active auth owner at every teardown boundary
          () => subjectRef.current,
          getAccessTokenSilently
        );
        await deleteAccount(
          deletionConfirmation,
          continuingBillingAcknowledged
        );
      } catch (error) {
        console.error(error);
        // stale billing warning guard
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          typeof error.data === "object" &&
          error.data !== null &&
          "error" in error.data &&
          error.data.error === "continuing_billing_acknowledgement_required"
        ) {
          setContinuingBillingWarningRequired(true);
          setDeletionError(
            "Confirm that you understand subscription billing can continue, then retry deletion."
          );
          setDeletionState("confirming");
          return;
        }
        setDeletionError(
          "Ferry FYI could not confirm account deletion. Sign in again; if your account is still active, retry."
        );
        setDeletionState("confirming");
        return;
      }
      clearCameraDetectionDebuggerAuthorization();
      try {
        await logout({ openUrl: false });
        navigate("/", { replace: true });
      } catch (error) {
        // completed deletion cleanup failure
        console.error("Local logout failed after account deletion", error);
        navigate("/logout", { replace: true });
      }
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
      <Page
        headerAction={
          /* top-bar logout */
          <button
            className="button button-outline button-small"
            onClick={onLogout}
            type="button"
          >
            Log Out
          </button>
        }
        title="Account"
      >
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
          {/* surface one teardown failure */}
          {logoutError && (
            <p
              className="text-sm font-semibold text-red-dark dark:text-red-light"
              role="alert"
            >
              {logoutError}
            </p>
          )}
          <AccountProfileHeader
            accountId={accountId}
            email={email}
            locale={locale}
            name={name}
            nickname={nickname}
            provider={provider}
            updatedAt={updatedAt}
            username={username}
          />

          <SupporterCard />

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

          <section
            className="rounded border border-red-dark bg-white p-6 shadow dark:bg-black"
            id="account-deletion"
          >
            <h3 className="text-xl font-bold text-red-dark dark:text-red-light">
              Delete account
            </h3>
            <p className="mt-2 text-sm text-gray-dark dark:text-gray-medium">
              Permanently delete your Ferry FYI login, saved alerts,
              preferences, server-side ticket cache, and leaderboard identity.
              Anonymous leaderboard scores may remain, but cannot be linked back
              to you.
            </p>
            <button
              className="button button-danger mt-4"
              onClick={openDeletion}
              type="button"
            >
              Delete account
            </button>
          </section>

          {deletionState !== "closed" && (
            <div
              aria-labelledby="account-deletion-title"
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onKeyDown={(event) => {
                // escape cancellation guard
                if (event.key === "Escape" && deletionState === "confirming") {
                  closeDeletion();
                }
              }}
              role="dialog"
            >
              <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-blue-darkest">
                <h3
                  className="text-xl font-bold text-red-dark dark:text-red-light"
                  id="account-deletion-title"
                >
                  Permanently delete account?
                </h3>
                <p className="mt-3 text-sm text-gray-dark dark:text-gray-medium">
                  This cannot be undone. You will need to create a new account
                  to use signed-in features again.
                </p>
                {(supporter.status?.active ||
                  continuingBillingWarningRequired) && (
                  <label className="mt-4 flex items-start gap-3 rounded-xl border border-red-dark/40 p-3 text-sm">
                    <input
                      checked={continuingBillingAcknowledged}
                      className="mt-1"
                      disabled={deletionState === "deleting"}
                      onChange={(event) =>
                        setContinuingBillingAcknowledged(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>
                      I understand deleting Ferry FYI does not cancel my
                      subscription. Billing can continue until I cancel through
                      the App Store, Google Play, or web billing portal, and
                      restore can require this original Ferry FYI account.
                    </span>
                  </label>
                )}
                <label
                  className="mt-4 block text-sm font-semibold"
                  htmlFor="account-deletion-confirmation"
                >
                  Type <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong> to
                  confirm.
                </label>
                <input
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  autoFocus
                  className="mt-2 w-full rounded border border-gray-medium bg-white p-2 text-gray-darkest dark:bg-blue-darkest dark:text-white"
                  disabled={deletionState === "deleting"}
                  id="account-deletion-confirmation"
                  onChange={(event) =>
                    setDeletionConfirmation(event.target.value)
                  }
                  spellCheck={false}
                  value={deletionConfirmation}
                />
                {deletionError && (
                  <p
                    className="mt-3 text-sm font-semibold text-red-dark dark:text-red-light"
                    role="alert"
                  >
                    {deletionError}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    className="button button-secondary"
                    disabled={deletionState === "deleting"}
                    onClick={closeDeletion}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-danger"
                    disabled={
                      deletionState === "deleting" ||
                      deletionConfirmation !== ACCOUNT_DELETION_CONFIRMATION ||
                      ((supporter.status?.active === true ||
                        continuingBillingWarningRequired) &&
                        !continuingBillingAcknowledged)
                    }
                    onClick={confirmDeletion}
                    type="button"
                  >
                    {deletionState === "deleting"
                      ? "Deleting…"
                      : "Permanently delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Page>
    );
  },
  { onRedirecting: () => <AccountLoadingState /> }
);
