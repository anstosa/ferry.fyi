import { useAuth0 } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import clsx from "clsx";
import React, { ReactElement, ReactNode, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useLocation } from "react-router-dom";
import type { Terminal } from "shared/contracts/terminals";
import type { AlertSubscriptionChannel } from "shared/contracts/user";
import {
  ALERT_SUBSCRIPTION_CHANNEL_IDS,
  ALERT_SUBSCRIPTION_CHANNELS,
  getRouteSubscriptionKey,
} from "shared/lib/alertSubscriptions";
import { without } from "shared/lib/arrays";

import { Splash } from "~/components/Splash";
import { TerminalDropdown } from "~/components/TerminalDropdown";
import { useDevice } from "~/lib/device";
import { getSlug, useTerminals } from "~/lib/terminals";
import { useUser } from "~/lib/user";
import BellIcon from "~/static/images/icons/solid/bell.svg";
import BellSlashIcon from "~/static/images/icons/solid/bell-slash.svg";
import CheckIcon from "~/static/images/icons/solid/check-circle.svg";
import type { GetPath } from "~/views/Route";

import { Header } from "./Header";

interface Props {
  getPath: GetPath;
  mate: Terminal;
  terminal: Terminal;
}

// channel equality guard
const areChannelsEqual = (
  left: AlertSubscriptionChannel[],
  right: AlertSubscriptionChannel[]
): boolean => {
  return (
    left.length === right.length &&
    left.every((channel) => {
      return right.includes(channel);
    })
  );
};

// legacy route guard
const isLegacySubscribedRoute = (
  subscribedTerminals: string[] | undefined,
  terminalIds: string[]
): boolean => {
  return terminalIds.some((terminalId) => {
    return subscribedTerminals?.includes(terminalId) ?? false;
  });
};

// terminal subscription guard
const hasSubscribedTerminal = ({
  alertSubscriptions,
  subscribedTerminals,
  terminalId,
}: {
  alertSubscriptions: Record<string, AlertSubscriptionChannel[]> | undefined;
  subscribedTerminals: string[] | undefined;
  terminalId: string;
}): boolean => {
  // legacy terminal guard
  if (subscribedTerminals?.includes(terminalId)) {
    return true;
  }
  return Object.entries(alertSubscriptions ?? {}).some(
    ([routeKey, channels]) => {
      const terminalIds = routeKey.split(":");
      return terminalIds.includes(terminalId) && channels.length > 0;
    }
  );
};

export const AlertSubscription = ({
  getPath,
  mate,
  terminal,
}: Props): ReactElement => {
  const device = useDevice();
  const location = useLocation();
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const { terminals } = useTerminals();
  const [
    { alertSubscriptions, isUserLoading, subscribedTerminals, user, userError },
    { refreshUser, updateUser },
  ] = useUser();
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<Error | null>(null);
  const terminalIds = [terminal.id, mate.id];
  const routeKey = getRouteSubscriptionKey(terminalIds);
  const savedChannels = alertSubscriptions?.[routeKey] ?? [];
  const legacySubscribed = isLegacySubscribedRoute(
    subscribedTerminals,
    terminalIds
  );
  const initialChannels =
    savedChannels.length > 0 || !legacySubscribed
      ? savedChannels
      : ALERT_SUBSCRIPTION_CHANNEL_IDS;
  const [selectedChannels, setSelectedChannels] =
    useState<AlertSubscriptionChannel[]>(initialChannels);
  const [isSaving, setSaving] = useState<boolean>(false);
  const [wasSaved, setWasSaved] = useState<boolean>(false);
  const isSubscribed = initialChannels.length > 0;
  const hasChanges = !areChannelsEqual(selectedChannels, initialChannels);
  const routeName = `${terminal.name} / ${mate.name}`;
  const titleText = `${terminal.name} Notifications`;
  const terminalOptions = terminals
    .filter(({ id }) => {
      // current terminal guard
      return id !== terminal.id;
    })
    .map((terminalOption) => {
      return {
        ...(hasSubscribedTerminal({
          alertSubscriptions,
          subscribedTerminals,
          terminalId: terminalOption.id,
        }) && {
          Icon: BellIcon,
        }),
        terminal: terminalOption,
      };
    });

  // auth redirect
  useEffect(() => {
    const login = async (): Promise<void> => {
      // authenticated guard
      if (isLoading || isAuthenticated) {
        return;
      }
      const redirectPath = `${location.pathname}${location.search}`;
      const loginOptions = {
        appState: { redirectPath },
        authorizationParams: {
          redirect_uri: process.env.AUTH0_CLIENT_REDIRECT,
        },
      };
      try {
        // native browser login
        if (device?.isNativeMobile) {
          await loginWithRedirect({
            ...loginOptions,
            openUrl: async (url) => {
              await Browser.open({ url });
            },
          });
          return;
        }
        await loginWithRedirect(loginOptions);
      } catch (error) {
        // login failure guard
        setLoginError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };
    login();
  }, [
    device?.isNativeMobile,
    isAuthenticated,
    isLoading,
    location.pathname,
    location.search,
    loginWithRedirect,
  ]);

  // sync saved state
  useEffect(() => {
    setSelectedChannels(initialChannels);
  }, [routeKey, initialChannels.join(":")]);

  // auth loading guard
  if (isLoading || (!isAuthenticated && !loginError)) {
    return <Splash />;
  }

  // channel toggle
  const toggleChannel = (channel: AlertSubscriptionChannel): void => {
    setWasSaved(false);
    setSelectedChannels((currentChannels) => {
      // selected guard
      if (currentChannels.includes(channel)) {
        return without(currentChannels, channel);
      }
      return [...currentChannels, channel];
    });
  };

  // save subscription
  const saveSubscription = async (
    channels: AlertSubscriptionChannel[] = selectedChannels
  ): Promise<void> => {
    setSaving(true);
    const nextAlertSubscriptions = { ...(alertSubscriptions ?? {}) };
    // empty route guard
    if (channels.length === 0) {
      delete nextAlertSubscriptions[routeKey];
    } else {
      nextAlertSubscriptions[routeKey] = channels;
    }
    const nextSubscribedTerminals = terminalIds.reduce(
      (currentTerminals, terminalId) => without(currentTerminals, terminalId),
      subscribedTerminals ?? []
    );
    try {
      await updateUser({
        app_metadata: {
          alertSubscriptions: nextAlertSubscriptions,
          subscribedTerminals: nextSubscribedTerminals,
        },
      });
      setWasSaved(true);
    } finally {
      setSaving(false);
    }
  };

  // unsubscribe route
  const unsubscribe = async (): Promise<void> => {
    setSelectedChannels([]);
    await saveSubscription([]);
  };

  // blocked state renderer
  const renderBlockedState = ({
    action,
    message,
    title,
  }: {
    action?: ReactNode;
    message: string;
    title: string;
  }): ReactElement => (
    <>
      <Header>
        <span className="text-center flex-1">Alert subscription</span>
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light px-4 py-8 text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <section className="mx-auto max-w-2xl rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
          <h1 className="text-2xl font-bold text-gray-darkest dark:text-white">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-dark dark:text-[#b8d5de]">
            {message}
          </p>
          {action && <div className="mt-4">{action}</div>}
        </section>
      </main>
    </>
  );

  // login error guard
  if (!isAuthenticated) {
    return renderBlockedState({
      action: (
        <button
          className="button button-invert"
          onClick={() => window.location.reload()}
          type="button"
        >
          Try logging in again
        </button>
      ),
      message: loginError?.message ?? "Login could not be started.",
      title: "Login required",
    });
  }

  // user loading guard
  if (!user && isUserLoading) {
    return <Splash />;
  }

  // user error guard
  if (!user) {
    return renderBlockedState({
      action: (
        <button
          className="button button-invert"
          onClick={() => refreshUser()}
          type="button"
        >
          Retry account sync
        </button>
      ),
      message:
        userError?.message ??
        "Your login succeeded, but your account preferences could not be loaded.",
      title: "Account preferences unavailable",
    });
  }

  return (
    <>
      <Helmet>
        <title>{`${titleText} - Ferry FYI`}</title>
        <link
          rel="canonical"
          href={`${process.env.BASE_URL}${getPath({ view: "subscribe" })}`}
        />
      </Helmet>
      <Header>
        <div className="flex-1 min-w-0" />
        <div className="min-w-0 text-center">
          <TerminalDropdown
            terminals={terminalOptions}
            selected={terminal}
            isOpen={isTerminalOpen}
            getOptionPath={(selectedTerminal) => {
              return `/${getSlug(selectedTerminal.id)}/subscribe`;
            }}
            setOpen={setTerminalOpen}
            onSelect={() => setTerminalOpen(false)}
          />
        </div>
        <span className="ml-2 shrink-0">Notifications</span>
        <div className="flex-1 min-w-0" />
      </Header>
      <main className="flex-grow overflow-y-scroll scrolling-touch bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5 pb-24 sm:px-6">
          <div className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-green-dark text-white dark:bg-green-light dark:text-blue-darkest">
                <BellIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-bold uppercase tracking-[0.16em] text-blue-dark dark:text-[#6fb8c8]">
                  {isSubscribed ? "Edit subscription" : "Subscribe"}
                </p>
                <h1 className="mt-1 text-2xl font-bold leading-tight text-gray-darkest dark:text-white">
                  {titleText}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-gray-dark dark:text-[#b8d5de]">
                  Choose exactly which push notifications you want for{" "}
                  {routeName}.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
            <h2 className="mb-3 text-lg font-bold text-gray-darkest dark:text-white">
              Notification channels
            </h2>
            <div className="flex flex-col gap-3">
              {ALERT_SUBSCRIPTION_CHANNELS.map(({ description, id, label }) => {
                const isSelected = selectedChannels.includes(id);
                return (
                  <button
                    aria-pressed={isSelected}
                    className={clsx(
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition",
                      isSelected
                        ? "border-green-dark bg-green-dark/10 text-green-dark dark:border-green-light dark:bg-green-light/10 dark:text-green-light"
                        : "border-gray-200 bg-gray-50 text-gray-dark hover:border-blue-dark dark:border-white/10 dark:bg-white/[0.03] dark:text-[#d8e8ec] dark:hover:border-[#6fb8c8]"
                    )}
                    disabled={isSaving}
                    key={id}
                    onClick={() => toggleChannel(id)}
                    type="button"
                  >
                    <span
                      className={clsx(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        isSelected
                          ? "border-green-dark bg-green-dark text-white dark:border-green-light dark:bg-green-light dark:text-blue-darkest"
                          : "border-gray-300 bg-white dark:border-white/20 dark:bg-transparent"
                      )}
                    >
                      {isSelected && <CheckIcon className="h-3 w-3" />}
                    </span>
                    <span>
                      <span className="block font-bold">{label}</span>
                      <span className="mt-1 block text-sm opacity-80">
                        {description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-4 shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]">
            {wasSaved && (
              <p className="rounded-xl bg-green-dark/10 px-3 py-2 text-sm font-bold text-green-dark dark:bg-green-light/10 dark:text-green-light">
                Subscription saved.
              </p>
            )}
            <button
              className={clsx("button button-primary", {
                "button-disabled": isSaving || !hasChanges,
              })}
              disabled={isSaving || !hasChanges}
              onClick={() => saveSubscription()}
              type="button"
            >
              {isSaving ? "Saving..." : "Save subscription"}
            </button>
            {isSubscribed && (
              <button
                className="button button-outline border-stale-light text-stale-light dark:border-[#ffb3b0] dark:text-[#ffb3b0]"
                disabled={isSaving}
                onClick={() => unsubscribe()}
                type="button"
              >
                <div className="button-icon">
                  <BellSlashIcon />
                </div>
                <span className="button-label">Unsubscribe from route</span>
              </button>
            )}
            <Link
              className="link self-center text-sm font-bold text-blue-dark dark:text-[#6fb8c8]"
              to="/account#subscriptions"
            >
              View all routes you are subscribed to
            </Link>
          </div>
        </section>
      </main>
    </>
  );
};
