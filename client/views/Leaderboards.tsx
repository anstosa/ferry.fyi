import { useAuth0 } from "@auth0/auth0-react";
import { Share } from "@capacitor/share";
import clsx from "clsx";
import React, {
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import type {
  Leaderboard,
  LeaderboardPeriod,
  LeaderboardPreferences,
  LeaderboardPreferencesUpdate,
} from "shared/contracts/leaderboards";
import {
  getLeaderboardsSeoMetadata,
  getTerminalLeaderboardSeoMetadata,
  getVesselLeaderboardSeoMetadata,
  type SeoMetadata,
} from "shared/lib/seo";

import {
  LeaderboardAutomaticCleanupRecovery,
  LeaderboardAutomaticEnrollment,
} from "~/components/LeaderboardAutomaticEnrollment";
import { LeaderboardManualCheckIn } from "~/components/LeaderboardManualCheckIn";
import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { ApiError } from "~/lib/api";
import { loginWithAppFlow } from "~/lib/auth";
import { useFavoriteRoutes } from "~/lib/favoriteRoutes";
import { useFeatureFlags } from "~/lib/featureFlags";
import { disableAutomaticLeaderboardAccount } from "~/lib/leaderboardAutomatic";
import { leaderboardInitials } from "~/lib/leaderboardLocation";
import {
  getFirstNonEmptyLeaderboard,
  getLeaderboardPreferences,
  getTerminalLeaderboard,
  getVesselLeaderboard,
  leaderboardPeriodOrder,
  updateLeaderboardPreferences,
} from "~/lib/leaderboards";
import {
  getRouteGroups,
  hasFavoriteRoute,
  sortRouteGroups,
} from "~/lib/routeGroups";
import { useTerminals } from "~/lib/terminals";
import { getVessel, useLiveVessels } from "~/lib/vessels";
import ArrowLeftIcon from "~/static/images/icons/solid/arrow-left.svg";
import BellIcon from "~/static/images/icons/solid/bell.svg";
import BellSlashIcon from "~/static/images/icons/solid/bell-slash.svg";
import CogIcon from "~/static/images/icons/solid/cog.svg";
import CrownIcon from "~/static/images/icons/solid/crown.svg";
import TerminalIcon from "~/static/images/icons/solid/garage-car.svg";
import ShareIcon from "~/static/images/icons/solid/share-alt.svg";
import ShipIcon from "~/static/images/icons/solid/ship.svg";
import StarFilledIcon from "~/static/images/icons/solid/star.svg";
import TrophyIcon from "~/static/images/icons/solid/trophy.svg";
import { SnapshotSeoHelmet } from "~/views/PublicSsrPages";

const periodLabels: Record<LeaderboardPeriod, string> = {
  all: "All time",
  month: "This month",
  week: "This week",
};

const periods = leaderboardPeriodOrder.map((value) => ({
  label: periodLabels[value],
  value,
}));

interface LeaderboardPeriodSelection {
  entityId: string;
  period: LeaderboardPeriod;
}

const getTerminalLeaderboardGridClasses = (columns = 2): string =>
  clsx("grid gap-2", {
    "grid-cols-2": columns === 2,
    "grid-cols-3": columns === 3,
  });

const leaderboardIndexCardClasses =
  "group flex h-full items-center gap-2 rounded-xl border border-gray-light bg-white p-2 text-gray-darkest shadow-sm transition hover:-translate-y-0.5 hover:border-yellow-medium hover:shadow-md dark:border-gray-dark dark:bg-blue-dark dark:text-white";

const seoFor = (
  path: string,
  title: string,
  description: string
): SeoMetadata => ({
  canonicalPath: path,
  description,
  robots: "index,follow",
  schema: { "@type": "WebPage", description, name: title, url: path },
  title,
});

const LeaderboardHero = ({
  action,
  children,
  eyebrow,
  footer,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  footer?: ReactNode;
  title: string;
}): ReactElement => (
  <section className="relative isolate mt-4 overflow-hidden rounded-2xl border border-[#b97804] bg-[linear-gradient(135deg,#fff6bb_0%,#f8d65a_26%,#d99a0a_52%,#ffe681_76%,#be7800_100%)] p-5 text-[#3d2800] shadow-[0_10px_24px_rgba(185,120,4,0.3)]">
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-gradient-to-br from-white/65 to-transparent"
    />
    <div className="relative flex items-start gap-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/35 shadow-sm">
        <TrophyIcon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-black uppercase tracking-[0.16em] text-[#654500]">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-2xl font-black leading-tight">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#614000]">
          {children}
        </p>
      </div>
      {action}
    </div>
    {footer && <div className="relative mt-4">{footer}</div>}
  </section>
);

const AllLeaderboardsBreadcrumb = (): ReactElement => (
  <nav aria-label="Breadcrumb" className="mt-4">
    <Link className="link inline-flex items-center gap-1" to="/leaderboards">
      <ArrowLeftIcon aria-hidden className="h-3 w-3" />
      All leaderboards
    </Link>
  </nav>
);

const leaderboardKey = (entityId: string, period: LeaderboardPeriod): string =>
  `${entityId}:${period}`;

const LeaderboardRankSkeleton = (): ReactElement => (
  <SkeletonGroup className="mt-4 space-y-2" label="Loading leaderboard">
    {[0, 1, 2, 3, 4].map((index) => (
      <div
        className="flex items-center gap-3 rounded-xl border border-gray-light px-4 py-3 dark:border-gray-dark"
        key={index}
      >
        <Skeleton className="h-6 w-6 shrink-0" variant="circle" />
        <Skeleton className="h-5 flex-1" variant="text" />
        <Skeleton className="h-5 w-8 shrink-0" variant="text" />
      </div>
    ))}
  </SkeletonGroup>
);

const RankList = ({
  entityId,
  isLoading,
  leaderboard,
  period,
}: {
  entityId: string;
  isLoading: boolean;
  leaderboard: Leaderboard | null;
  period: LeaderboardPeriod;
}): ReactElement => {
  const isCurrent =
    leaderboard !== null &&
    leaderboardKey(leaderboard.entityId, leaderboard.period) ===
      leaderboardKey(entityId, period);

  if (!isCurrent) {
    return <LeaderboardRankSkeleton />;
  }
  if (!leaderboard.ranks.length) {
    return (
      <p aria-busy={isLoading} className="mt-4 text-sm">
        No check-ins yet. Be the first to appear here.
      </p>
    );
  }
  return (
    <ol
      aria-busy={isLoading}
      className="mt-4 divide-y divide-gray-light overflow-hidden rounded-2xl border border-gray-light dark:divide-gray-dark dark:border-gray-dark"
    >
      {leaderboard.ranks.map((rank) => {
        const isFirstPlace = rank.rank === 1;
        return (
          <li
            className={clsx(
              "flex items-center gap-3 px-4 py-3",
              isFirstPlace &&
                "bg-[linear-gradient(105deg,#fff6bb_0%,#f8d65a_52%,#ffe681_100%)] text-[#604000] dark:bg-yellow-medium/20 dark:text-yellow-lightest"
            )}
            key={`${rank.rank}:${rank.label}`}
          >
            <strong
              aria-label={isFirstPlace ? "Rank 1" : `Rank ${rank.rank}`}
              className={clsx(
                "flex w-6 shrink-0 items-center justify-center",
                isFirstPlace
                  ? "text-yellow-dark dark:text-yellow-light"
                  : "text-green-dark dark:text-green-light"
              )}
            >
              {isFirstPlace ? (
                <CrownIcon aria-hidden className="h-5 w-5" />
              ) : (
                rank.rank
              )}
            </strong>
            <span className="min-w-0 flex-1 truncate font-medium">
              {rank.label}
            </span>
            <span className="font-bold">{rank.score}</span>
          </li>
        );
      })}
    </ol>
  );
};

const PeriodSelector = ({
  onChange,
  period,
}: {
  onChange: (period: LeaderboardPeriod) => void;
  period: LeaderboardPeriod;
}): ReactElement => (
  <div
    aria-label="Leaderboard period"
    className="mt-4 flex gap-5 border-b border-gray-light dark:border-gray-dark"
    role="group"
  >
    {periods.map(({ label, value }) => {
      const isSelected = value === period;
      return (
        <button
          aria-pressed={isSelected}
          className={clsx(
            "-mb-px border-b-2 px-1 pb-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-dark dark:focus-visible:outline-green-light",
            isSelected
              ? "border-green-dark text-green-dark dark:border-green-light dark:text-green-light"
              : "border-transparent text-gray-dark hover:border-gray-medium hover:text-gray-darkest dark:text-gray-light dark:hover:border-gray-medium dark:hover:text-white"
          )}
          key={value}
          onClick={() => onChange(value)}
          type="button"
        >
          {label}
        </button>
      );
    })}
  </div>
);

const ShareButton = ({ title }: { title: string }): ReactElement => {
  const [message, setMessage] = useState("Share leaderboard");
  const share = async (): Promise<void> => {
    try {
      await Share.share({ title, text: title, url: window.location.href });
      setMessage("Shared!");
      window.setTimeout(() => setMessage("Share"), 3000);
    } catch {
      // ignore one dismissed native share dialog
    }
  };
  return (
    <button
      aria-label={message}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      onClick={() => share()}
      type="button"
    >
      <ShareIcon aria-hidden className="h-5 w-5" />
    </button>
  );
};

const NotificationToggleButton = ({
  className,
  disabled = false,
  enabled,
  onClick,
}: {
  className?: string;
  disabled?: boolean;
  enabled: boolean;
  onClick: () => void;
}): ReactElement => {
  const Icon = enabled ? BellIcon : BellSlashIcon;
  return (
    <button
      aria-label={
        enabled
          ? "Turn off check-in notifications"
          : "Turn on check-in notifications"
      }
      aria-pressed={enabled}
      className={clsx("button", className)}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon className="button-icon" />
      {enabled ? "Notifications on" : "Notifications off"}
    </button>
  );
};

// leaderboard preferences
const Preferences = (): ReactElement => {
  const {
    getAccessTokenSilently,
    isAuthenticated,
    loginWithPopup,
    loginWithRedirect,
    user,
  } = useAuth0();
  const { leaderboardsEnabled } = useFeatureFlags();
  const [preferences, setPreferences] = useState<LeaderboardPreferences | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingOptOut, setConfirmingOptOut] = useState(false);
  // track the current cleanup owner across asynchronous auth changes
  const subjectRef = useRef<string | null>(user?.sub ?? null);
  subjectRef.current = user?.sub ?? null;

  useEffect(() => {
    if (!leaderboardsEnabled || !isAuthenticated) {
      return;
    }
    getAccessTokenSilently()
      .then(async (accessToken) => {
        const current = await getLeaderboardPreferences(accessToken);
        const defaultLabel = leaderboardInitials({
          family_name: user?.family_name,
          given_name: user?.given_name,
          name: user?.name,
          nickname: user?.nickname,
        });
        if (!current.displayName && defaultLabel) {
          return updateLeaderboardPreferences(
            { initials: defaultLabel, useFullName: false },
            accessToken
          );
        }
        if (current.useFullName || current.verboseNotificationsEnabled) {
          return updateLeaderboardPreferences(
            { useFullName: false, verboseNotificationsEnabled: false },
            accessToken
          );
        }
        return current;
      })
      .then(setPreferences)
      .catch(() => setError("Could not load leaderboard settings."));
  }, [getAccessTokenSilently, isAuthenticated, user]);
  if (!isAuthenticated) {
    return (
      <button
        className="button"
        onClick={() =>
          loginWithAppFlow({
            loginWithPopup,
            loginWithRedirect,
            options: {
              appState: { redirectPath: "/leaderboards/settings" },
            },
          })
        }
        type="button"
      >
        Sign in to check in
      </button>
    );
  }
  if (!preferences) {
    return error ? (
      <p className="text-sm text-stale-dark">{error}</p>
    ) : (
      <SkeletonGroup
        className="mt-4 space-y-3"
        label="Loading leaderboard settings"
      >
        <Skeleton className="h-4 w-28" variant="text" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </SkeletonGroup>
    );
  }
  // save one reviewed preference update
  const save = async (
    update: LeaderboardPreferencesUpdate
  ): Promise<boolean> => {
    const optimistic = {
      ...preferences,
      ...update,
      useFullName: false,
      verboseNotificationsEnabled: false,
    };
    setSaving(true);
    setError(null);
    window.dispatchEvent(
      new CustomEvent<LeaderboardPreferences>(
        "leaderboard-preferences-changed",
        { detail: optimistic }
      )
    );
    try {
      const saved = await updateLeaderboardPreferences(
        {
          ...update,
          useFullName: false,
          verboseNotificationsEnabled: false,
        },
        await getAccessTokenSilently()
      );
      setPreferences(saved);
      window.dispatchEvent(
        new CustomEvent<LeaderboardPreferences>(
          "leaderboard-preferences-changed",
          { detail: saved }
        )
      );
      return true;
    } catch {
      // restore the last saved preferences after failure
      window.dispatchEvent(
        new CustomEvent<LeaderboardPreferences>(
          "leaderboard-preferences-changed",
          { detail: preferences }
        )
      );
      setError("Could not save leaderboard settings.");
      return false;
    } finally {
      setSaving(false);
    }
  };
  // purge native material before the server opt-out and revocation transaction
  const optOut = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await disableAutomaticLeaderboardAccount(
        "profile_opted_out",
        subjectRef.current ?? "",
        // recheck the active auth owner at every teardown boundary
        () => subjectRef.current,
        getAccessTokenSilently
      );
    } catch {
      setError(
        "Automatic check-in cleanup did not finish. Retry before opting out."
      );
      setSaving(false);
      return false;
    }
    setSaving(false);
    return await save({ automaticCheckinsEnabled: false, optedOut: true });
  };
  return (
    <section className="mt-4">
      <label className="block text-sm">
        Display name
        <input
          className="mt-1 w-full rounded border p-2 dark:bg-blue-dark"
          disabled={preferences.optedOut || saving}
          maxLength={80}
          onChange={(event) =>
            setPreferences({ ...preferences, displayName: event.target.value })
          }
          value={preferences.displayName}
        />
      </label>
      <NotificationToggleButton
        className="mt-3"
        disabled={preferences.optedOut || saving}
        enabled={preferences.notificationsEnabled}
        // save one notification preference
        onClick={() =>
          save({ notificationsEnabled: !preferences.notificationsEnabled })
        }
      />
      <LeaderboardAutomaticEnrollment
        disabled={preferences.optedOut || saving}
        onPreferencesChange={setPreferences}
        preferences={preferences}
      />
      <div className="mt-4 flex items-center justify-between gap-2">
        {preferences.optedOut ? (
          <button
            className="button button-primary"
            disabled={saving}
            // restore one opted-in preference
            onClick={() =>
              save({ optedOut: false }).then(
                // close confirmation after one saved update
                (saved) => {
                  // close only after server confirmation
                  if (saved) {
                    setConfirmingOptOut(false);
                  }
                }
              )
            }
            type="button"
          >
            Opt in
          </button>
        ) : (
          <button
            className="button button-outline border-red-dark text-red-dark hover:bg-red-dark hover:text-white dark:border-red-light dark:text-red-light dark:hover:bg-red-light dark:hover:text-red-dark"
            disabled={saving}
            // open one explicit opt-out confirmation
            onClick={() => setConfirmingOptOut(true)}
            type="button"
          >
            Opt out
          </button>
        )}
        <button
          className="button button-primary"
          disabled={preferences.optedOut || saving}
          // save one reviewed display name
          onClick={() => save({ displayName: preferences.displayName })}
          type="button"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {confirmingOptOut && !preferences.optedOut && (
        <section
          aria-labelledby="opt-out-confirmation-title"
          className="mt-3 rounded-xl border border-red-dark bg-red-light p-3 text-red-dark dark:bg-red-dark/20 dark:text-red-light"
          role="alertdialog"
        >
          <h2 className="font-bold" id="opt-out-confirmation-title">
            Opt out of leaderboards?
          </h2>
          <p className="mt-1 text-sm">
            New check-ins will stop and your name will be removed from public
            leaderboards.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="button"
              disabled={saving}
              // cancel one opt-out confirmation
              onClick={() => setConfirmingOptOut(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              disabled={saving}
              // start one complete opt-out transaction
              onClick={() =>
                optOut().then(
                  // close confirmation after one saved opt-out
                  (saved) => {
                    // close only after server confirmation
                    if (saved) {
                      setConfirmingOptOut(false);
                    }
                  }
                )
              }
              type="button"
            >
              Confirm opt out
            </button>
          </div>
        </section>
      )}
      {error && <p className="mt-2 text-sm text-stale-dark">{error}</p>}
    </section>
  );
};

const TerminalLeaderboard = (): ReactElement => {
  const { terminalId = "" } = useParams();
  const { leaderboardsEnabled } = useFeatureFlags();
  const { terminals } = useTerminals();
  const terminal = terminals.find(({ id }) => id === terminalId);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] =
    useState<LeaderboardPeriodSelection | null>(null);
  const [defaultPeriod, setDefaultPeriod] =
    useState<LeaderboardPeriodSelection | null>(null);
  const explicitPeriod =
    selectedPeriod?.entityId === terminalId ? selectedPeriod.period : null;
  const period =
    explicitPeriod ??
    (defaultPeriod?.entityId === terminalId ? defaultPeriod.period : "week");

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      setLoading(true);
      if (explicitPeriod) {
        try {
          const next = await getTerminalLeaderboard(terminalId, explicitPeriod);
          if (active) {
            setLeaderboard(next);
          }
        } catch {
          if (active) {
            setLeaderboard({
              entityId: terminalId,
              period: explicitPeriod,
              ranks: [],
            });
          }
        }
        return;
      }

      try {
        const next = await getFirstNonEmptyLeaderboard((candidate) =>
          getTerminalLeaderboard(terminalId, candidate)
        );
        if (!active) {
          return;
        }
        if (next) {
          setDefaultPeriod({ entityId: terminalId, period: next.period });
          setLeaderboard(next);
          return;
        }
        setDefaultPeriod({ entityId: terminalId, period: "week" });
        setLeaderboard({ entityId: terminalId, period: "week", ranks: [] });
      } catch {
        if (active) {
          setLeaderboard({ entityId: terminalId, period: "week", ranks: [] });
        }
      }
    };
    load()
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [explicitPeriod, terminalId]);

  const name = terminal?.name ?? terminalId;
  return (
    <Page
      headerAction={
        <ShareButton title={`${name} ferry terminal leaderboard`} />
      }
      title={`${name} leaderboard`}
    >
      <SnapshotSeoHelmet
        fallback={getTerminalLeaderboardSeoMetadata({
          id: terminalId,
          name,
        })}
      />
      <AllLeaderboardsBreadcrumb />
      <LeaderboardHero eyebrow="Terminal leaderboard" title={name}>
        Check in at {name} and see who is leading this terminal.
      </LeaderboardHero>
      {leaderboardsEnabled && (
        <LeaderboardManualCheckIn
          entityId={terminalId}
          kind="terminal"
          name={name}
        />
      )}
      <PeriodSelector
        onChange={(nextPeriod) =>
          setSelectedPeriod({ entityId: terminalId, period: nextPeriod })
        }
        period={period}
      />
      <RankList
        entityId={terminalId}
        isLoading={isLoading}
        key={leaderboardKey(terminalId, period)}
        leaderboard={leaderboard}
        period={period}
      />
    </Page>
  );
};

const VesselLeaderboard = (): ReactElement => {
  const { vesselId = "" } = useParams();
  const { leaderboardsEnabled } = useFeatureFlags();
  const [name, setName] = useState(vesselId);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] =
    useState<LeaderboardPeriodSelection | null>(null);
  const [defaultPeriod, setDefaultPeriod] =
    useState<LeaderboardPeriodSelection | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const vesselCheckinsEnabled = leaderboardsEnabled;
  const explicitPeriod =
    selectedPeriod?.entityId === vesselId ? selectedPeriod.period : null;
  const period =
    explicitPeriod ??
    (defaultPeriod?.entityId === vesselId ? defaultPeriod.period : "week");

  useEffect(() => {
    getVessel(vesselId)
      .then((vessel) => setName(vessel.name))
      .catch(() => undefined);
  }, [vesselId]);

  useEffect(() => {
    let active = true;
    const unavailableForVessels = (error: unknown): boolean =>
      error instanceof ApiError &&
      (error.status === 404 || error.status === 503);
    const load = async (): Promise<void> => {
      setLoading(true);
      if (!vesselCheckinsEnabled) {
        setUnavailable(true);
        return;
      }
      setUnavailable(false);
      if (explicitPeriod) {
        try {
          const next = await getVesselLeaderboard(vesselId, explicitPeriod);
          if (active) {
            setLeaderboard(next);
          }
        } catch (error) {
          if (!active) {
            return;
          }
          if (unavailableForVessels(error)) {
            setUnavailable(true);
            return;
          }
          setLeaderboard({
            entityId: vesselId,
            period: explicitPeriod,
            ranks: [],
          });
        }
        return;
      }

      try {
        const next = await getFirstNonEmptyLeaderboard((candidate) =>
          getVesselLeaderboard(vesselId, candidate)
        );
        if (!active) {
          return;
        }
        if (next) {
          setDefaultPeriod({ entityId: vesselId, period: next.period });
          setLeaderboard(next);
          return;
        }
        setDefaultPeriod({ entityId: vesselId, period: "week" });
        setLeaderboard({ entityId: vesselId, period: "week", ranks: [] });
      } catch (error) {
        if (!active) {
          return;
        }
        if (unavailableForVessels(error)) {
          setUnavailable(true);
          return;
        }
        setLeaderboard({ entityId: vesselId, period: "week", ranks: [] });
      }
    };
    load()
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [explicitPeriod, vesselCheckinsEnabled, vesselId]);

  return (
    <Page
      headerAction={<ShareButton title={`${name} ferry leaderboard`} />}
      title={`${name} leaderboard`}
    >
      <SnapshotSeoHelmet
        fallback={getVesselLeaderboardSeoMetadata({
          id: vesselId,
          name,
        })}
      />
      <AllLeaderboardsBreadcrumb />
      <LeaderboardHero eyebrow="Vessel leaderboard" title={name}>
        See the check-in leaders aboard {name}.
      </LeaderboardHero>
      {vesselCheckinsEnabled && (
        <LeaderboardManualCheckIn
          entityId={vesselId}
          kind="vessel"
          name={name}
        />
      )}
      {unavailable ? (
        <p className="mt-4">Vessel check-ins are unavailable right now.</p>
      ) : (
        <>
          <PeriodSelector
            onChange={(nextPeriod) =>
              setSelectedPeriod({ entityId: vesselId, period: nextPeriod })
            }
            period={period}
          />
          <RankList
            entityId={vesselId}
            isLoading={isLoading}
            key={leaderboardKey(vesselId, period)}
            leaderboard={leaderboard}
            period={period}
          />
        </>
      )}
    </Page>
  );
};

const LeaderboardControls = (): ReactElement | null => {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [enabled, setEnabled] = useState(true);
  const [isSaving, setSaving] = useState(false);
  useEffect(() => {
    if (isAuthenticated) {
      getAccessTokenSilently()
        .then(getLeaderboardPreferences)
        .then((preferences) => setEnabled(preferences.notificationsEnabled))
        .catch(() => undefined);
    }
  }, [getAccessTokenSilently, isAuthenticated]);
  const toggleNotifications = async (): Promise<void> => {
    if (!isAuthenticated || isSaving) {
      return;
    }
    setSaving(true);
    try {
      const preferences = await updateLeaderboardPreferences(
        { notificationsEnabled: !enabled },
        await getAccessTokenSilently()
      );
      setEnabled(preferences.notificationsEnabled);
    } finally {
      setSaving(false);
    }
  };
  const heroButtonClass = clsx(
    "button button-small border-[#b97804]/50 bg-white/35 text-[#3d2800]",
    "hover:bg-white/60 hover:text-[#3d2800] focus-visible:ring-2 focus-visible:ring-yellow-light"
  );
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <NotificationToggleButton
        className={heroButtonClass}
        disabled={!isAuthenticated || isSaving}
        enabled={enabled}
        onClick={() => toggleNotifications()}
      />
      <Link className={heroButtonClass} to="/leaderboards/settings">
        <CogIcon className="button-icon" />
        Settings
      </Link>
    </div>
  );
};

const LeaderboardSettings = (): ReactElement => (
  <Page title="Leaderboard settings">
    <SeoHelmet
      seo={{
        ...seoFor(
          "/leaderboards/settings",
          "Leaderboard settings - Ferry FYI",
          "Manage Ferry FYI leaderboard preferences."
        ),
        robots: "noindex,follow",
      }}
    />
    <Preferences />
  </Page>
);

const LeaderboardHome = (): ReactElement => {
  const { closestTerminal, terminals } = useTerminals();
  const [favoriteRouteIds] = useFavoriteRoutes();
  const { leaderboardsEnabled } = useFeatureFlags();
  const vesselCheckinsEnabled = leaderboardsEnabled;
  const vessels = useLiveVessels(vesselCheckinsEnabled, 5 * 60_000);
  const routeGroups = sortRouteGroups(
    getRouteGroups(terminals),
    closestTerminal,
    favoriteRouteIds
  );

  return (
    <Page title="Leaderboards">
      <SnapshotSeoHelmet fallback={getLeaderboardsSeoMetadata()} />
      <LeaderboardHero
        eyebrow="Ferry FYI"
        footer={<LeaderboardControls />}
        title="Leaderboards"
      >
        Check in, climb the rankings, and see who leads at each terminal and
        aboard each vessel.
      </LeaderboardHero>
      <h2 className="mt-8 text-center font-bold text-lg">
        Terminal leaderboards
      </h2>
      <div className="mt-4 grid gap-6">
        {routeGroups.map((routeGroup) => (
          <section key={routeGroup.id}>
            <h3 className="mb-2 text-center text-sm font-extrabold uppercase tracking-[0.18em] text-green-dark dark:text-green-light">
              <span className="inline-flex items-center gap-2">
                {hasFavoriteRoute(routeGroup, favoriteRouteIds) && (
                  <span className="inline-flex items-center">
                    <StarFilledIcon aria-hidden className="h-3 w-3" />
                    <span className="sr-only">Contains a favorite route</span>
                  </span>
                )}
                {routeGroup.label}
              </span>
            </h3>
            <ul
              className={getTerminalLeaderboardGridClasses(
                routeGroup.terminalColumns
              )}
            >
              {routeGroup.terminals.map((terminal) => (
                <li key={terminal.id}>
                  <Link
                    className={leaderboardIndexCardClasses}
                    to={`/leaderboards/terminals/${terminal.id}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-lightest text-yellow-dark dark:bg-yellow-medium/20 dark:text-yellow-lightest">
                      <TerminalIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold group-hover:text-green-dark dark:group-hover:text-green-light">
                        {terminal.name}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <h2 className="mt-8 text-center font-bold text-lg">
        Vessel leaderboards
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {vessels.map((vessel) => (
          <li key={vessel.id}>
            <Link
              className={leaderboardIndexCardClasses}
              to={`/leaderboards/vessels/${vessel.id}`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-lightest text-yellow-dark dark:bg-yellow-medium/20 dark:text-yellow-lightest">
                <ShipIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold group-hover:text-green-dark dark:group-hover:text-green-light">
                  {vessel.name}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
};

export const Leaderboards = (): ReactElement => {
  const disabledSeo = {
    ...getLeaderboardsSeoMetadata(),
    robots: "noindex,follow" as const,
  };
  const { leaderboardsEnabled } = useFeatureFlags();
  // preserve cleanup recovery behind the parent gate
  if (!leaderboardsEnabled) {
    return (
      <Page title="Leaderboards">
        <SnapshotSeoHelmet fallback={disabledSeo} />
        <p className="mt-4">Leaderboards are not available yet.</p>
        <LeaderboardAutomaticCleanupRecovery />
      </Page>
    );
  }
  return (
    <Routes>
      <Route path="" element={<LeaderboardHome />} />
      <Route path="settings" element={<LeaderboardSettings />} />
      <Route path="terminals/:terminalId" element={<TerminalLeaderboard />} />
      <Route path="vessels/:vesselId" element={<VesselLeaderboard />} />
      <Route path="*" element={<Navigate replace to="/leaderboards" />} />
    </Routes>
  );
};
