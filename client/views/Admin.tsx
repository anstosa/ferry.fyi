import { useAuth0 } from "@auth0/auth0-react";
import { DateTime } from "luxon";
import React, { ReactElement, ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import type {
  AdminConfirmationAction,
  AdminUserList,
  AdminUserListItem,
} from "shared/contracts/admin";
import {
  AD_SLOT_IDS,
  type AdCampaign,
  type AdCampaignReport,
  type AdConfiguration,
  type AdInventoryReport,
  type AdPlacement,
  type AdReportShareCreated,
  type AdReportShareSummary,
  type AdSlotId,
  getAdPlacementKey,
} from "shared/contracts/ads";
import type { Terminal } from "shared/contracts/terminals";
import type { TicketLookupAdminSettings } from "shared/contracts/tickets";

import { AdInventoryCharts } from "~/components/AdInventoryCharts";
import { Page } from "~/components/Page";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { confirmationPhrase } from "~/lib/adminConfirmation";
import { getAdAdminSelection } from "~/lib/ads";
import { del, get, post, put } from "~/lib/api";
import { getTerminals } from "~/lib/terminals";

const ADMIN_EMAIL = "anstosa@gmail.com";
const AD_TIME_ZONE = "America/Los_Angeles";
const AD_LOCAL_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";

const adCampaignTimestamp = (value: string): string => {
  const parsed = DateTime.fromISO(value, { zone: AD_TIME_ZONE });
  const timestamp = parsed.toUTC().toISO();
  if (
    !parsed.isValid ||
    parsed.toFormat(AD_LOCAL_TIME_FORMAT) !== value ||
    parsed.getPossibleOffsets().length !== 1 ||
    !timestamp
  ) {
    throw new Error("Invalid or ambiguous Pacific campaign time");
  }
  return timestamp;
};

const formatAdCampaignTime = (value: string): string =>
  DateTime.fromISO(value)
    .setZone(AD_TIME_ZONE)
    .toFormat("MMM d, yyyy, h:mm a ZZZZ");

// build one bounded inventory query
const adInventoryReportPath = (
  startDate: string,
  endDate: string,
  placementKey: string | null
): string => {
  const params = new URLSearchParams({ endDate, startDate });
  // include an optional placement drill-down
  if (placementKey) {
    params.set("placementKey", placementKey);
  }
  return `/admin/ads/reports/inventory?${params.toString()}`;
};

type FeatureSettings = {
  automaticLeaderboardCheckinsEnabled: boolean;
  leaderboardsEnabled: boolean;
};
type DetailedFeatureSettings = {
  enabled: boolean;
  killSwitch: boolean;
  name: string;
  subjects: string[];
};
// identify one independently managed feature
type ManagedFeatureName = "automaticLeaderboardCheckins" | "leaderboards";
// group subject-aware feature decisions
type DetailedFeatureMap = Record<ManagedFeatureName, DetailedFeatureSettings>;
// retain one editable allowlist per feature
type FeatureAllowlistMap = Record<ManagedFeatureName, string>;
type AdminNotificationMode = "broadcast" | "targeted" | "test";
type NotificationPreview = { recipientCount: number };
type NotificationSendResult = {
  acceptedCount: number;
  delivery: "not-confirmed";
  notSubmittedCount: number;
  recipientCount: number;
};
type NotificationRequest = {
  action: AdminConfirmationAction;
  previewPath: string;
  sendPath: string;
  target: string;
};
type Operation = {
  canRun: boolean;
  description: string;
  error: string | null;
  lastRunAt: string | null;
  operation: string;
  result: string | null;
  startedAt: string | null;
  status: string;
  trigger: string;
};
type NotificationDashboard = {
  inFlight: number;
  policy: { paused: boolean };
  queueState: "active" | "not-queued";
  queued: number;
  requestResult: string | null;
};
type Announcement = {
  body: string;
  id: string;
  published: boolean;
  title: string;
};
type Content = {
  announcements: Announcement[];
  crawlerPolicy: { aiCrawlers: "allow" | "disallow"; disallowPaths: string[] };
  leaderboardIndexingEnabled: boolean;
  leaderboardSharingEnabled: boolean;
  maintenance: { enabled: boolean; message: string };
};
type UserSupportProfile = {
  email?: string;
  leaderboard: {
    checkins: { terminal: number; total: number; vessel: number };
    optedOut: boolean | null;
    profile: {
      automaticCheckinsEnabled: boolean;
      displayName: string;
      notificationsEnabled: boolean;
      optedOut: boolean;
      verboseNotificationsEnabled: boolean;
    } | null;
    profileExists: boolean;
    terminalPresenceCount: number;
  };
  settings: {
    alertRules: {
      channels: string[];
      endTime: string;
      id: string;
      nickname?: string;
      routeKey: string;
      startTime: string;
      terminalIds: string[];
    }[];
    alertSubscriptions: Record<string, string[]>;
    favoriteRouteIds: string[];
    hasPushToken: boolean;
    subscribedTerminalIds: string[];
    ticketCount: number;
  } | null;
  subject: string;
};
type AdminTab =
  | "access"
  | "users"
  | "operations"
  | "notifications"
  | "tickets"
  | "ads"
  | "content";

const adminTabs: { id: AdminTab; label: string }[] = [
  { id: "access", label: "Access" },
  { id: "users", label: "Users" },
  { id: "operations", label: "Data operations" },
  { id: "notifications", label: "Notifications" },
  { id: "tickets", label: "Ticket lookup" },
  { id: "ads", label: "Advertising" },
  { id: "content", label: "Content & SEO" },
];

const adSlotLabels: Record<AdSlotId, string> = {
  cameras: "Cameras",
  fare: "Fares",
  home: "Home",
  schedule: "Schedule",
  terminal: "Terminal details",
};

interface AdDirection {
  arrivalTerminalId: string;
  departureTerminalId: string;
  key: string;
  label: string;
}

const getAdDirections = (terminals: Terminal[]): AdDirection[] =>
  terminals
    .flatMap((terminal) =>
      (terminal.mates ?? []).map((mate) => ({
        arrivalTerminalId: mate.id,
        departureTerminalId: terminal.id,
        key: `${terminal.id}--${mate.id}`,
        label: `${terminal.name} → ${mate.name}`,
      }))
    )
    .filter(
      (direction, index, directions) =>
        directions.findIndex(
          (candidate) =>
            candidate.departureTerminalId === direction.departureTerminalId &&
            candidate.arrivalTerminalId === direction.arrivalTerminalId
        ) === index
    )
    .sort((left, right) => left.label.localeCompare(right.label));

const emptyAdPlacement = ({
  arrivalTerminalId,
  departureTerminalId,
  slot,
}: {
  arrivalTerminalId: string | null;
  departureTerminalId: string | null;
  slot: AdSlotId;
}): AdPlacement => ({
  advertiserName: "",
  arrivalTerminalId,
  body: "",
  departureTerminalId,
  enabled: false,
  headline: "",
  key: getAdPlacementKey({
    arrivalTerminalId,
    departureTerminalId,
    slot,
  }),
  slot,
  targetUrl: "",
});

const ToggleSwitch = ({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): ReactElement => (
  <button
    aria-checked={checked}
    aria-label={label}
    className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-dark ${
      checked ? "bg-green-dark" : "bg-gray-300 dark:bg-white/20"
    }`}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    role="switch"
    type="button"
  >
    <span
      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
        checked ? "left-6" : "left-1"
      }`}
    />
  </button>
);

const notificationRequest = (
  mode: AdminNotificationMode,
  userSubject: string,
  targetedSubject: string
): NotificationRequest => {
  switch (mode) {
    case "broadcast":
      return {
        action: "send-broadcast-notification",
        previewPath: "/admin/notifications/broadcast/preview",
        sendPath: "/admin/notifications/broadcast/send",
        target: "notification:broadcast",
      };
    case "test":
      return {
        action: "send-test-notification",
        previewPath: "/admin/notifications/test/preview",
        sendPath: "/admin/notifications/test/send",
        target: `notification:test:${userSubject}`,
      };
    case "targeted":
      return {
        action: "send-targeted-notification",
        previewPath: `/admin/notifications/targeted/${encodeURIComponent(targetedSubject)}/preview`,
        sendPath: `/admin/notifications/targeted/${encodeURIComponent(targetedSubject)}/send`,
        target: `notification:targeted:${targetedSubject}`,
      };
  }
};

export const getAdminUserLookupPath = (
  lookupType: "email" | "subject",
  value: string
): string =>
  `/admin/users/lookup?${lookupType}=${encodeURIComponent(value.trim())}`;

const NotificationUserSelector = ({
  error,
  onQueryChange,
  onSearch,
  onSelect,
  query,
  results,
  selected,
}: {
  error: string | null;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onSelect: (user: AdminUserListItem) => void;
  query: string;
  results: AdminUserList | null;
  selected: AdminUserListItem | null;
}): ReactElement => (
  <div className="mt-3">
    <label className="block font-semibold" htmlFor="notification-user-search">
      Recipient
    </label>
    <p className="mt-1 text-sm">
      Search by email or Auth0 subject, then select one user.
    </p>
    <form
      className="mt-2 flex w-full"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <input
        className="h-12 min-w-0 flex-1 rounded-l-2xl rounded-r-none border border-r-0 border-gray-medium bg-white px-4 py-2 text-gray-900 focus:z-10 dark:bg-blue-darkest dark:text-gray-100"
        id="notification-user-search"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search email or Auth0 subject"
        value={query}
      />
      <button
        className="button button-group-right button-primary shrink-0"
        disabled={!query.trim()}
        type="submit"
      >
        Search
      </button>
    </form>
    {error && (
      <p className="mt-2 text-sm text-red-dark" role="alert">
        {error}
      </p>
    )}
    {selected && (
      <p className="mt-2 text-sm">
        Selected: <strong>{selected.email ?? selected.subject}</strong>
      </p>
    )}
    {results && (
      <ul
        aria-label="Notification recipient results"
        className="mt-2 max-h-48 divide-y divide-gray-light overflow-y-auto rounded border border-gray-light dark:divide-gray-dark dark:border-gray-dark"
      >
        {results.items.map((item) => (
          <li key={item.subject}>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-light dark:hover:bg-blue-darkest"
              onClick={() => onSelect(item)}
              type="button"
            >
              <span className="block font-semibold">
                {item.email ?? "No email available"}
              </span>
              <span className="block break-all text-xs text-gray-dark dark:text-gray-light">
                {item.subject}
              </span>
            </button>
          </li>
        ))}
        {results.items.length === 0 && (
          <li className="p-3 text-sm">No users matched this search.</li>
        )}
      </ul>
    )}
  </div>
);

const AdminLoadingSkeleton = ({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}): ReactElement => (
  <SkeletonGroup className="mt-4 space-y-3" label={label}>
    <Skeleton className="h-6 w-2/5" variant="text" />
    {Array.from({ length: rows }, (_, index) => (
      <Skeleton className="h-16 w-full" key={index} />
    ))}
  </SkeletonGroup>
);

const AdminSection = ({
  active,
  children,
  description,
  id,
  load,
  loadingFallback,
  title,
}: {
  active: boolean;
  children: ReactNode;
  description: string;
  id: string;
  load?: () => Promise<void>;
  loadingFallback: ReactNode;
  title: string;
}): ReactElement | null => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || loaded || !load || error) {
      return;
    }
    load()
      .then(() => setLoaded(true))
      .catch(() => setError(`Could not load ${title.toLowerCase()}.`));
  }, [active, error, load, loaded, title]);

  if (!active) {
    return null;
  }

  let sectionContent: ReactNode = loadingFallback;
  if (error) {
    sectionContent = <p className="mt-3 text-sm text-red-dark">{error}</p>;
  } else if (loaded) {
    sectionContent = children;
  }

  return (
    <section
      aria-labelledby={`admin-section-${id}`}
      className="rounded-2xl border border-gray-light bg-white p-4 dark:border-gray-dark dark:bg-blue-dark"
    >
      <h2 className="font-bold text-lg" id={`admin-section-${id}`}>
        {title}
      </h2>
      <p className="mt-2 text-sm text-gray-dark dark:text-gray-light">
        {description}
      </p>
      {sectionContent}
    </section>
  );
};

const ConfirmButton = ({
  action,
  buttonClassName = "button button-primary mt-3",
  containerClassName = "mt-3",
  disabled,
  label,
  onConfirm,
  target,
  trigger,
}: {
  action: AdminConfirmationAction;
  buttonClassName?: string;
  containerClassName?: string;
  disabled?: boolean;
  label: string;
  onConfirm: () => Promise<void>;
  target: string;
  trigger?: (props: { disabled: boolean; onClick: () => void }) => ReactElement;
}): ReactElement => {
  const phrase = confirmationPhrase(action, target);
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm();
      setConfirmation("");
      setOpen(false);
    } catch {
      setError("The server did not complete this admin action.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={containerClassName}>
      {trigger ? (
        trigger({ disabled: Boolean(disabled), onClick: () => setOpen(true) })
      ) : (
        <button
          className={buttonClassName}
          disabled={disabled}
          onClick={() => setOpen(true)}
          type="button"
        >
          {label}
        </button>
      )}
      {open && (
        <div
          aria-labelledby={`${action}-${target}-title`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-blue-darkest">
            <h3 className="font-bold text-lg" id={`${action}-${target}-title`}>
              Confirm {label}
            </h3>
            <label
              className="mt-3 block text-sm font-semibold"
              htmlFor={`${action}-${target}`}
            >
              Type <code className="break-all text-xs">{phrase}</code> to{" "}
              {label.toLowerCase()}.
            </label>
            <input
              aria-label={`Confirmation for ${label}`}
              autoFocus
              className="mt-2 w-full rounded border border-gray-medium bg-white p-2 text-sm text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
              id={`${action}-${target}`}
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
            {error && <p className="mt-2 text-sm text-red-dark">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="button button-secondary"
                disabled={saving}
                onClick={() => setOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={saving || confirmation !== phrase}
                onClick={execute}
                type="button"
              >
                {saving ? "Working…" : label}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// isolate ticket lookup state
const TicketLookupAdminSection = ({
  active,
  token,
}: {
  active: boolean;
  token: () => Promise<string>;
}): ReactElement => {
  const [settings, setSettings] = useState<TicketLookupAdminSettings | null>(
    null
  );

  // load ticket lookup settings
  const loadSettings = async (): Promise<void> => {
    setSettings(
      await get<TicketLookupAdminSettings>("/admin/tickets", await token())
    );
  };

  // update the draft profile
  const selectUserAgentProfile = (
    event: React.ChangeEvent<HTMLSelectElement>
  ): void => {
    if (!settings) {
      return;
    }
    const selectedProfile = settings.userAgentProfiles.find(
      ({ id }) => id === event.target.value
    );
    // known profile guard
    if (!selectedProfile) {
      return;
    }
    setSettings({
      ...settings,
      selectedUserAgentProfile: selectedProfile.id,
    });
  };

  // save the confirmed draft
  const saveSettings = async (): Promise<void> => {
    if (!settings) {
      return;
    }
    const target = "ticket-lookup:settings";
    setSettings(
      await put<TicketLookupAdminSettings>(
        "/admin/tickets/settings",
        {
          action: "save-ticket-lookup-settings",
          confirmation: confirmationPhrase(
            "save-ticket-lookup-settings",
            target
          ),
          selectedUserAgentProfile: settings.selectedUserAgentProfile,
          target,
        },
        await token()
      )
    );
  };

  // resolve the selected profile
  const selectedProfile = settings?.userAgentProfiles.find(
    ({ id }) => id === settings.selectedUserAgentProfile
  );

  return (
    <AdminSection
      active={active}
      description="Control the truthful product identity used for serialized, cached Wave2Go ticket lookups. Browser impersonation is not available."
      id="tickets"
      load={loadSettings}
      loadingFallback={
        <AdminLoadingSkeleton label="Loading ticket lookup settings" />
      }
      title="Ticket lookup"
    >
      {settings ? (
        <div className="mt-4 space-y-4">
          <label
            className="block font-semibold"
            htmlFor="ticket-lookup-user-agent"
          >
            Outbound User-Agent profile
          </label>
          <select
            className="w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
            id="ticket-lookup-user-agent"
            onChange={selectUserAgentProfile}
            value={settings.selectedUserAgentProfile}
          >
            {/* render profile options */}
            {settings.userAgentProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
          <p className="break-all rounded bg-gray-lightest p-3 font-mono text-xs text-gray-darkest dark:bg-blue-darkest dark:text-gray-light">
            {selectedProfile?.userAgent}
          </p>
          <p className="text-sm text-gray-dark dark:text-gray-light">
            Lookups run one at a time. Successful results remain in a bounded,
            in-memory cache for {settings.cacheTtlSeconds / 60} minutes.
            Changing the profile clears that cache; it does not bypass upstream
            access controls.
          </p>
          <ConfirmButton
            action="save-ticket-lookup-settings"
            label="Save ticket lookup settings"
            target="ticket-lookup:settings"
            onConfirm={saveSettings}
          />
        </div>
      ) : null}
    </AdminSection>
  );
};

export const Admin = (): ReactElement => {
  const { getAccessTokenSilently, isAuthenticated, user } = useAuth0();
  const adminSearch =
    typeof window === "undefined" ? "" : window.location.search;
  const requestedAdSelection = getAdAdminSelection(adminSearch);
  const requestedAdminTab = new URLSearchParams(adminSearch).get("tab");
  const [activeTab, setActiveTab] = useState<AdminTab>(() =>
    requestedAdSelection
      ? "ads"
      : (adminTabs.find(({ id }) => id === requestedAdminTab)?.id ?? "access")
  );
  const [features, setFeatures] = useState<FeatureSettings | null>(null);
  const [detailedFeatures, setDetailedFeatures] =
    useState<DetailedFeatureMap | null>(null);
  const [featureAllowlists, setFeatureAllowlists] =
    useState<FeatureAllowlistMap>({
      automaticLeaderboardCheckins: "",
      leaderboards: "",
    });
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [notifications, setNotifications] =
    useState<NotificationDashboard | null>(null);
  const [ads, setAds] = useState<AdConfiguration | null>(null);
  const [adTerminals, setAdTerminals] = useState<Terminal[]>([]);
  const [selectedAdSlot, setSelectedAdSlot] = useState<AdSlotId>(
    requestedAdSelection?.slot ?? "home"
  );
  const [selectedAdDirection, setSelectedAdDirection] = useState(
    requestedAdSelection?.directionKey ?? ""
  );
  const [adDraft, setAdDraft] = useState<AdPlacement | null>(null);
  const [adCampaigns, setAdCampaigns] = useState<AdCampaign[]>([]);
  const [adCampaignReport, setAdCampaignReport] =
    useState<AdCampaignReport | null>(null);
  const [adInventoryReport, setAdInventoryReport] =
    useState<AdInventoryReport | null>(null);
  const [adInventoryPlacementKey, setAdInventoryPlacementKey] = useState<
    string | null
  >(requestedAdSelection?.placementKey ?? null);
  const [adInventoryLoading, setAdInventoryLoading] = useState(false);
  const [adInventoryError, setAdInventoryError] = useState<string | null>(null);
  const [adReportShares, setAdReportShares] = useState<AdReportShareSummary[]>(
    []
  );
  const [createdAdReportShare, setCreatedAdReportShare] =
    useState<AdReportShareCreated | null>(null);
  const [adReportName, setAdReportName] = useState("");
  const [adStartsAt, setAdStartsAt] = useState("");
  const [adEndsAt, setAdEndsAt] = useState("");
  const [adInventoryEndDate, setAdInventoryEndDate] = useState(
    () => DateTime.now().setZone(AD_TIME_ZONE).toISODate() ?? ""
  );
  const [adInventoryStartDate, setAdInventoryStartDate] = useState(() => {
    return (
      DateTime.now().setZone(AD_TIME_ZONE).minus({ days: 29 }).toISODate() ?? ""
    );
  });
  const [content, setContent] = useState<Content | null>(null);
  const [userDirectory, setUserDirectory] = useState<AdminUserList | null>(
    null
  );
  const [userDirectoryError, setUserDirectoryError] = useState<string | null>(
    null
  );
  const [userPage, setUserPage] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [userProfile, setUserProfile] = useState<UserSupportProfile | null>(
    null
  );
  const [userError, setUserError] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [announcementPublished, setAnnouncementPublished] = useState(false);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [notificationMode, setNotificationMode] =
    useState<AdminNotificationMode>("test");
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationBody, setNotificationBody] = useState("");
  const [notificationPreview, setNotificationPreview] =
    useState<NotificationPreview | null>(null);
  const [notificationResult, setNotificationResult] =
    useState<NotificationSendResult | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(
    null
  );
  const [notificationRecipient, setNotificationRecipient] =
    useState<AdminUserListItem | null>(null);
  const [notificationRecipientError, setNotificationRecipientError] = useState<
    string | null
  >(null);
  const [notificationRecipientResults, setNotificationRecipientResults] =
    useState<AdminUserList | null>(null);
  const [notificationRecipientSearch, setNotificationRecipientSearch] =
    useState("");

  const currentNotification = notificationRequest(
    notificationMode,
    user?.sub ?? "",
    notificationRecipient?.subject ?? ""
  );
  const token = (): Promise<string> => getAccessTokenSilently();
  const loadFeatures = async (): Promise<void> => {
    const accessToken = await token();
    const [legacy, leaderboards, automaticLeaderboardCheckins] =
      await Promise.all([
        get<FeatureSettings>("/admin/features", accessToken),
        get<DetailedFeatureSettings>(
          "/admin/features/leaderboards",
          accessToken
        ),
        get<DetailedFeatureSettings>(
          "/admin/features/automaticLeaderboardCheckins",
          accessToken
        ),
      ]);
    setFeatures(legacy);
    setDetailedFeatures({ automaticLeaderboardCheckins, leaderboards });
    setFeatureAllowlists({
      automaticLeaderboardCheckins:
        automaticLeaderboardCheckins.subjects.join("\n"),
      leaderboards: leaderboards.subjects.join("\n"),
    });
  };
  const loadOperations = async (): Promise<void> => {
    const value = await get<{ operations: Operation[] }>(
      "/admin/operations",
      await token()
    );
    setOperations(value.operations);
  };
  const loadNotifications = async (): Promise<void> =>
    setNotifications(await get("/admin/notifications", await token()));
  // load ad controls and default analytics
  const loadAds = async (): Promise<void> => {
    const accessToken = await token();
    const [configuration, terminals, campaigns, inventory] = await Promise.all([
      get<AdConfiguration>("/admin/ads", accessToken),
      getTerminals(),
      get<AdCampaign[]>("/admin/ads/campaigns", accessToken),
      get<AdInventoryReport>(
        adInventoryReportPath(
          adInventoryStartDate,
          adInventoryEndDate,
          adInventoryPlacementKey
        ),
        accessToken
      ),
    ]);
    const directions = getAdDirections(terminals);
    setAds(configuration);
    setAdTerminals(terminals);
    setAdCampaigns(campaigns);
    setAdInventoryReport(inventory);
    setSelectedAdDirection((current) => current || directions[0]?.key || "");
  };

  const loadAdCampaignReport = async (campaignId: string): Promise<void> => {
    const accessToken = await token();
    const [report, shares] = await Promise.all([
      get<AdCampaignReport>(
        `/admin/ads/reports/campaigns/${encodeURIComponent(campaignId)}`,
        accessToken
      ),
      get<AdReportShareSummary[]>(
        `/admin/ads/campaigns/${encodeURIComponent(campaignId)}/shares`,
        accessToken
      ),
    ]);
    setAdCampaignReport(report);
    setAdReportShares(shares);
    setCreatedAdReportShare(null);
  };

  // refresh aggregate or placement analytics
  const loadAdInventoryReport = async (
    placementKey = adInventoryPlacementKey
  ): Promise<void> => {
    setAdInventoryError(null);
    setAdInventoryLoading(true);
    try {
      setAdInventoryReport(
        await get<AdInventoryReport>(
          adInventoryReportPath(
            adInventoryStartDate,
            adInventoryEndDate,
            placementKey
          ),
          await token()
        )
      );
    } catch {
      setAdInventoryError("Could not load advertising inventory analytics.");
    } finally {
      setAdInventoryLoading(false);
    }
  };

  // open one placement breakdown
  const selectAdInventoryPlacement = (placementKey: string): void => {
    setAdInventoryPlacementKey(placementKey);
    loadAdInventoryReport(placementKey).catch(() => undefined);
  };

  const downloadAdCampaignCsv = async (campaignId: string): Promise<void> => {
    const csv = await get<string>(
      `/admin/ads/reports/campaigns/${encodeURIComponent(campaignId)}.csv`,
      await token()
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ad-campaign-${campaignId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const loadContent = async (): Promise<void> => {
    const value = await get<Content>("/admin/content", await token());
    setContent(value);
    setMaintenanceMessage(value.maintenance.message);
  };
  const loadNotificationRecipients = async (): Promise<void> => {
    const query = notificationRecipientSearch.trim();
    if (!query) {
      return;
    }
    setNotificationRecipientError(null);
    try {
      const params = new URLSearchParams({ page: "0", query });
      setNotificationRecipientResults(
        await get<AdminUserList>(
          `/admin/users?${params.toString()}`,
          await token()
        )
      );
    } catch {
      setNotificationRecipientError(
        "Could not search for notification recipients."
      );
    }
  };
  const loadUserDirectory = async (page = userPage): Promise<void> => {
    setUserDirectoryError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (userSearch.trim()) {
        params.set("query", userSearch.trim());
      }
      const directory = await get<AdminUserList>(
        `/admin/users?${params.toString()}`,
        await token()
      );
      setUserDirectory(directory);
      setUserPage(directory.page);
    } catch {
      setUserDirectoryError("Could not load the user directory.");
      if (!userDirectory) {
        throw new Error("Could not load the user directory.");
      }
    }
  };
  const selectUser = async (item: AdminUserListItem): Promise<void> => {
    setUserError(null);
    setUserProfile(null);
    try {
      const profile = await get<UserSupportProfile>(
        getAdminUserLookupPath("subject", item.subject),
        await token()
      );
      setUserProfile(profile);
    } catch {
      setUserError("Could not load this user’s support profile.");
    }
  };
  // save one subject-aware feature policy
  const saveDetailedFeature = async (
    name: ManagedFeatureName
  ): Promise<void> => {
    // require loaded subject policy
    if (!detailedFeatures) {
      return;
    }
    setFeatureError(null);
    try {
      const value = await put<DetailedFeatureSettings>(
        `/admin/features/${name}`,
        {
          enabled: detailedFeatures[name].enabled,
          subjects: featureAllowlists[name].split(/\s+/).filter(Boolean),
        },
        await token()
      );
      setDetailedFeatures({ ...detailedFeatures, [name]: value });
      setFeatureAllowlists({
        ...featureAllowlists,
        [name]: value.subjects.join("\n"),
      });
    } catch {
      setFeatureError("Could not save private feature access.");
    }
  };
  const adDirections = getAdDirections(adTerminals);
  const selectedDirection = adDirections.find(
    ({ key }) => key === selectedAdDirection
  );

  useEffect(() => {
    if (!ads) {
      return;
    }
    const isHome = selectedAdSlot === "home";
    if (!isHome && !selectedDirection) {
      setAdDraft(null);
      return;
    }
    const input = {
      arrivalTerminalId: isHome
        ? null
        : (selectedDirection?.arrivalTerminalId ?? null),
      departureTerminalId: isHome
        ? null
        : (selectedDirection?.departureTerminalId ?? null),
      slot: selectedAdSlot,
    };
    const key = getAdPlacementKey(input);
    setAdDraft(
      ads.placements.find((placement) => placement.key === key) ??
        emptyAdPlacement(input)
    );
  }, [adTerminals, ads, selectedAdDirection, selectedAdSlot]);

  useEffect(() => {
    if (!ads || !requestedAdSelection) {
      return;
    }
    document
      .getElementById("admin-ad-placement")
      ?.scrollIntoView?.({ block: "start" });
    document.getElementById("admin-ad-slot")?.focus();
  }, [ads, requestedAdSelection?.placementKey]);

  if (!isAuthenticated || user?.email !== ADMIN_EMAIL) {
    return <Navigate replace to="/" />;
  }
  return (
    <Page title="Admin">
      <p className="my-4 text-sm text-gray-dark dark:text-gray-light">
        Owner-only controls. Destructive actions require the exact
        server-validated phrase; this console does not load user data until a
        supported lookup exists.
      </p>
      <div
        aria-label="Admin tools"
        className="mb-4 flex gap-5 overflow-x-auto overflow-y-hidden border-b border-gray-light dark:border-gray-dark"
        role="tablist"
      >
        {adminTabs.map((tab) => (
          <button
            aria-controls={`admin-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={`-mb-px whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-dark dark:focus-visible:outline-green-light ${
              activeTab === tab.id
                ? "border-green-dark text-green-dark dark:border-green-light dark:text-green-light"
                : "border-transparent text-gray-dark hover:border-gray-medium hover:text-gray-darkest dark:text-gray-light dark:hover:border-gray-medium dark:hover:text-white"
            }`}
            id={`admin-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`admin-tab-${activeTab}`}
        className="space-y-4"
        id={`admin-panel-${activeTab}`}
        role="tabpanel"
      >
        <AdminSection
          active={activeTab === "access"}
          description="Control parent leaderboard access and the independent automatic-check-in rollout with server-enforced kill switches and exact Auth0 subject allowlists."
          id="access"
          load={loadFeatures}
          loadingFallback={
            <AdminLoadingSkeleton label="Loading feature flags" />
          }
          title="Feature flags"
        >
          {features && detailedFeatures ? (
            <div className="mt-4 space-y-4">
              {(
                [
                  {
                    description:
                      "Enable public leaderboard pages and manual check-ins.",
                    label: "Leaderboards",
                    name: "leaderboards",
                  },
                  {
                    description:
                      "Allow explicit native automatic enrollment for eligible subjects. The parent leaderboard flag still applies.",
                    label: "Automatic leaderboard check-ins",
                    name: "automaticLeaderboardCheckins",
                  },
                ] as const
              ).map(
                // render one independently managed feature
                ({ description, label, name }) => {
                  const detail = detailedFeatures[name];
                  const target = `feature:${name}:kill-switch`;
                  return (
                    <section
                      className="rounded border border-gray-light p-4 dark:border-gray-dark"
                      key={name}
                    >
                      <label className="flex items-center justify-between gap-4">
                        <span>
                          <strong>{label}</strong>
                          <span className="mt-1 block text-sm">
                            {description}
                          </span>
                        </span>
                        <ToggleSwitch
                          checked={detail.enabled}
                          label={`Enable ${label.toLowerCase()}`}
                          // stage one feature decision
                          onChange={(enabled) =>
                            setDetailedFeatures({
                              ...detailedFeatures,
                              [name]: { ...detail, enabled },
                            })
                          }
                        />
                      </label>
                      <div className="mt-3">
                        <label
                          className="block font-semibold"
                          htmlFor={`${name}-allowlist`}
                        >
                          Private subject allowlist
                        </label>
                        <p className="mt-1 text-sm">
                          One exact Auth0 subject per line. An allowlist never
                          overrides this flag&apos;s kill switch or the parent
                          leaderboard policy.
                        </p>
                        <textarea
                          aria-label={`${label} subject allowlist`}
                          className="mt-2 w-full rounded border border-gray-medium bg-white p-2 text-sm text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                          id={`${name}-allowlist`}
                          // stage one exact subject allowlist
                          onChange={(event) =>
                            setFeatureAllowlists({
                              ...featureAllowlists,
                              [name]: event.target.value,
                            })
                          }
                          value={featureAllowlists[name]}
                        />
                        <button
                          className="button button-primary mt-3"
                          // save one reviewed feature policy
                          onClick={() => saveDetailedFeature(name)}
                          type="button"
                        >
                          Save {label.toLowerCase()} access
                        </button>
                      </div>
                      <p className="mt-3 text-sm">
                        Emergency kill switch:{" "}
                        <strong>
                          {detail.killSwitch ? "active" : "inactive"}
                        </strong>
                        . It disables global and allowlisted access immediately.
                      </p>
                      <ConfirmButton
                        action="set-feature-kill-switch"
                        buttonClassName={
                          detail.killSwitch
                            ? "button button-primary mt-3"
                            : "button mt-3 border-red-dark bg-transparent text-red-dark hover:bg-red-dark hover:text-white"
                        }
                        label={
                          detail.killSwitch
                            ? `Disable ${label.toLowerCase()} kill switch`
                            : `Enable ${label.toLowerCase()} kill switch`
                        }
                        target={target}
                        // commit one confirmed kill-switch change
                        onConfirm={async () => {
                          const value = await put<DetailedFeatureSettings>(
                            `/admin/features/${name}/kill-switch`,
                            {
                              action: "set-feature-kill-switch",
                              confirmation: confirmationPhrase(
                                "set-feature-kill-switch",
                                target
                              ),
                              enabled: !detail.killSwitch,
                              target,
                            },
                            await token()
                          );
                          setDetailedFeatures({
                            ...detailedFeatures,
                            [name]: value,
                          });
                        }}
                      />
                    </section>
                  );
                }
              )}
              {featureError && (
                <p className="text-sm text-red-dark">{featureError}</p>
              )}
            </div>
          ) : null}
        </AdminSection>

        <AdminSection
          active={activeTab === "users"}
          description="Search the owner-only Auth0 directory, then select one user to load their Ferry FYI support data."
          id="users"
          load={loadUserDirectory}
          loadingFallback={
            <AdminLoadingSkeleton label="Loading user directory" rows={4} />
          }
          title="User directory"
        >
          <div className="mt-4 space-y-4">
            <form
              className="flex w-full"
              onSubmit={(event) => {
                event.preventDefault();
                setUserPage(0);
                loadUserDirectory(0).catch(() => undefined);
              }}
            >
              <label className="sr-only" htmlFor="admin-user-search">
                Search users
              </label>
              <input
                className="h-12 min-w-0 flex-1 rounded-l-2xl rounded-r-none border border-r-0 border-gray-medium bg-white px-4 py-2 text-gray-900 focus:z-10 dark:bg-blue-darkest dark:text-gray-100"
                id="admin-user-search"
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Search email or Auth0 subject"
                value={userSearch}
              />
              <button
                className="button button-group-right button-primary shrink-0"
                type="submit"
              >
                Search
              </button>
            </form>
            {userDirectoryError && (
              <p className="text-sm text-red-dark" role="alert">
                {userDirectoryError}
              </p>
            )}
            {userDirectory ? (
              <>
                <p className="text-sm">
                  {userDirectory.total} users · page {userDirectory.page + 1}
                </p>
                <ul
                  aria-label="User directory results"
                  className="max-h-96 divide-y divide-gray-light overflow-y-auto rounded border border-gray-light dark:divide-gray-dark dark:border-gray-dark"
                >
                  {userDirectory.items.map((item) => (
                    <li key={item.subject}>
                      <button
                        className="w-full px-3 py-2 text-left hover:bg-gray-light dark:hover:bg-blue-darkest"
                        onClick={() => selectUser(item)}
                        type="button"
                      >
                        <span className="block font-semibold">
                          {item.email ?? "No email available"}
                        </span>
                        <span className="block break-all text-xs text-gray-dark dark:text-gray-light">
                          {item.subject}
                        </span>
                      </button>
                    </li>
                  ))}
                  {userDirectory.items.length === 0 && (
                    <li className="p-3 text-sm">
                      No users matched this search.
                    </li>
                  )}
                </ul>
                <div className="flex justify-between gap-2">
                  <button
                    className="button button-secondary"
                    disabled={userDirectory.page === 0}
                    onClick={() => loadUserDirectory(userDirectory.page - 1)}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={
                      (userDirectory.page + 1) * userDirectory.pageSize >=
                      userDirectory.total
                    }
                    onClick={() => loadUserDirectory(userDirectory.page + 1)}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </>
            ) : null}
            {userError && (
              <p className="mt-2 text-sm text-red-dark" role="alert">
                {userError}
              </p>
            )}
            {userProfile && (
              <div className="mt-4 rounded border border-gray-light p-3 text-sm dark:border-gray-dark">
                <p>
                  <strong>Subject:</strong> {userProfile.subject}
                </p>
                {userProfile.email && (
                  <p>
                    <strong>Email:</strong> {userProfile.email}
                  </p>
                )}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <h3 className="font-semibold">App settings</h3>
                    {userProfile.settings ? (
                      <ul className="mt-1 space-y-1">
                        <li>
                          Favorite routes:{" "}
                          {userProfile.settings.favoriteRouteIds.join(", ") ||
                            "none"}
                        </li>
                        <li>
                          Subscribed terminals:{" "}
                          {userProfile.settings.subscribedTerminalIds.join(
                            ", "
                          ) || "none"}
                        </li>
                        <li>
                          Tickets saved: {userProfile.settings.ticketCount}
                        </li>
                        <li>
                          Push token:{" "}
                          {userProfile.settings.hasPushToken
                            ? "present (redacted)"
                            : "none"}
                        </li>
                      </ul>
                    ) : (
                      <p className="mt-1">No Ferry FYI settings.</p>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">Leaderboard</h3>
                    <ul className="mt-1 space-y-1">
                      <li>
                        Check-ins: {userProfile.leaderboard.checkins.total} ({" "}
                        {userProfile.leaderboard.checkins.terminal} terminal,{" "}
                        {userProfile.leaderboard.checkins.vessel} vessel)
                      </li>
                      <li>
                        Terminal presences:{" "}
                        {userProfile.leaderboard.terminalPresenceCount}
                      </li>
                      <li>
                        Profile:{" "}
                        {userProfile.leaderboard.profileExists
                          ? "present"
                          : "none"}
                        {userProfile.leaderboard.profile?.displayName
                          ? ` (${userProfile.leaderboard.profile.displayName})`
                          : ""}
                      </li>
                      {userProfile.leaderboard.profile && (
                        <li>
                          Notifications:{" "}
                          {userProfile.leaderboard.profile.notificationsEnabled
                            ? "on"
                            : "off"}
                          ; verbose:{" "}
                          {userProfile.leaderboard.profile
                            .verboseNotificationsEnabled
                            ? "on"
                            : "off"}
                          ; opted out:{" "}
                          {userProfile.leaderboard.profile.optedOut
                            ? "yes"
                            : "no"}
                          ; automatic check-ins:{" "}
                          {userProfile.leaderboard.profile
                            .automaticCheckinsEnabled
                            ? "on"
                            : "off"}
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
                {userProfile.settings && (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-semibold">
                      Alert subscriptions (
                      {userProfile.settings.alertRules.length} rules)
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-light p-2 text-xs dark:bg-blue-darkest">
                      {JSON.stringify(
                        {
                          rules: userProfile.settings.alertRules,
                          subscriptions:
                            userProfile.settings.alertSubscriptions,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                )}
                <ConfirmButton
                  action="force-sign-out"
                  buttonClassName="button button-small mt-3 border-red-dark bg-transparent text-red-dark hover:bg-red-dark hover:text-white"
                  label="Force sign out"
                  target={`user:${userProfile.subject}`}
                  onConfirm={async () => {
                    await post(
                      `/admin/users/${encodeURIComponent(userProfile.subject)}/force-sign-out`,
                      {
                        action: "force-sign-out",
                        confirmation: confirmationPhrase(
                          "force-sign-out",
                          `user:${userProfile.subject}`
                        ),
                        target: `user:${userProfile.subject}`,
                      },
                      await token()
                    );
                  }}
                />
                <ConfirmButton
                  action="delete-user-data"
                  buttonClassName="button button-small mt-3 border-red-dark bg-transparent text-red-dark hover:bg-red-dark hover:text-white"
                  label="Delete Ferry FYI data"
                  target={`user:${userProfile.subject}`}
                  onConfirm={async () => {
                    await del(
                      `/admin/users/${encodeURIComponent(userProfile.subject)}`,
                      {
                        action: "delete-user-data",
                        confirmation: confirmationPhrase(
                          "delete-user-data",
                          `user:${userProfile.subject}`
                        ),
                        target: `user:${userProfile.subject}`,
                      },
                      await token()
                    );
                    setUserProfile(null);
                  }}
                />
              </div>
            )}
          </div>
        </AdminSection>

        <AdminSection
          active={activeTab === "operations"}
          description="Run one supported data refresh at a time. Status is aggregate operational data only."
          id="operations"
          load={loadOperations}
          loadingFallback={
            <AdminLoadingSkeleton label="Loading data health operations" />
          }
          title="Data health operations"
        >
          {operations ? (
            <ul
              className="mt-4 space-y-3"
              aria-label="Available data operations"
            >
              {operations.map((operation) => {
                const target = `operation:${operation.operation}`;
                const action: AdminConfirmationAction =
                  operation.operation === "clear-wsf-memory-cache"
                    ? "clear-cache"
                    : "run-operation";
                return (
                  <li
                    className="rounded border border-gray-light p-3 dark:border-gray-dark"
                    key={operation.operation}
                  >
                    <strong>{operation.operation}</strong>
                    <span className="ml-2 text-sm">{operation.status}</span>
                    <p className="mt-1 text-sm">{operation.description}</p>
                    <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                      <strong>Normal trigger:</strong> {operation.trigger}
                    </p>
                    <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                      <strong>Last run:</strong>{" "}
                      {operation.lastRunAt
                        ? new Date(operation.lastRunAt).toLocaleString()
                        : "Never recorded"}
                    </p>
                    {operation.error && (
                      <p className="text-sm text-red-dark">{operation.error}</p>
                    )}
                    {operation.canRun ? (
                      <ConfirmButton
                        action={action}
                        label="Run operation"
                        target={target}
                        onConfirm={async () => {
                          await post(
                            `/admin/operations/${operation.operation}/run`,
                            {
                              action,
                              confirmation: confirmationPhrase(action, target),
                              target,
                            },
                            await token()
                          );
                          await loadOperations();
                        }}
                      />
                    ) : (
                      <p className="mt-3 text-sm text-gray-dark dark:text-gray-light">
                        Scheduled automatically; no manual action is available.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </AdminSection>

        <AdminSection
          active={activeTab === "notifications"}
          description="Pause all sends at the final policy boundary, or preview and send a one-off notification only to consenting recipients. Provider acceptance is never delivery confirmation."
          id="notifications"
          load={loadNotifications}
          loadingFallback={
            <AdminLoadingSkeleton label="Loading notification policy and status" />
          }
          title="Notification policy and status"
        >
          {notifications ? (
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-semibold">Pause notifications</span>
                <ConfirmButton
                  action={
                    notifications.policy.paused
                      ? "resume-notifications"
                      : "pause-notifications"
                  }
                  containerClassName="shrink-0"
                  label={
                    notifications.policy.paused
                      ? "Resume notifications"
                      : "Pause notifications"
                  }
                  target="notification-policy:global"
                  trigger={({ disabled, onClick }) => (
                    <ToggleSwitch
                      checked={notifications.policy.paused}
                      disabled={disabled}
                      label="Pause notifications"
                      onChange={onClick}
                    />
                  )}
                  onConfirm={async () => {
                    const action = notifications.policy.paused
                      ? "resume-notifications"
                      : "pause-notifications";
                    await post(
                      `/admin/notifications/${notifications.policy.paused ? "resume" : "pause"}`,
                      {
                        action,
                        confirmation: confirmationPhrase(
                          action,
                          "notification-policy:global"
                        ),
                        target: "notification-policy:global",
                      },
                      await token()
                    );
                    await loadNotifications();
                  }}
                />
              </div>
              <p className="text-sm">
                Queue:{" "}
                {notifications.queueState === "not-queued"
                  ? "not queued"
                  : notifications.queued}
                ; in flight: {notifications.inFlight}; current result:{" "}
                {notifications.requestResult ?? "none"}.
              </p>
              <div className="border-t border-gray-light pt-4 dark:border-gray-dark">
                <h3 className="font-semibold">One-off notification</h3>
                <p className="mt-1 text-sm">
                  No templates or send history are stored. Test sends only to
                  this owner; targeted sends require a selected recipient;
                  broadcasts filter to current opt-in alert consent and FCM
                  tokens.
                </p>
                <label
                  className="mt-3 block font-semibold"
                  htmlFor="admin-notification-mode"
                >
                  Audience
                </label>
                <select
                  id="admin-notification-mode"
                  className="mt-1 rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  onChange={(event) => {
                    setNotificationMode(
                      event.target.value as AdminNotificationMode
                    );
                    setNotificationPreview(null);
                    setNotificationResult(null);
                  }}
                  value={notificationMode}
                >
                  <option value="test">Test to me</option>
                  <option value="targeted">Selected user</option>
                  <option value="broadcast">All consenting recipients</option>
                </select>
                {notificationMode === "targeted" && (
                  <NotificationUserSelector
                    error={notificationRecipientError}
                    onQueryChange={(query) => {
                      setNotificationRecipientSearch(query);
                      setNotificationRecipientError(null);
                    }}
                    onSearch={() => {
                      loadNotificationRecipients().catch(() => undefined);
                    }}
                    onSelect={(recipient) => {
                      setNotificationRecipient(recipient);
                      setNotificationPreview(null);
                      setNotificationResult(null);
                    }}
                    query={notificationRecipientSearch}
                    results={notificationRecipientResults}
                    selected={notificationRecipient}
                  />
                )}
                <label
                  className="mt-3 block font-semibold"
                  htmlFor="admin-notification-title"
                >
                  Title
                </label>
                <input
                  className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  id="admin-notification-title"
                  maxLength={120}
                  onChange={(event) => setNotificationTitle(event.target.value)}
                  value={notificationTitle}
                />
                <label
                  className="mt-3 block font-semibold"
                  htmlFor="admin-notification-body"
                >
                  Message
                </label>
                <textarea
                  className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  id="admin-notification-body"
                  maxLength={500}
                  onChange={(event) => setNotificationBody(event.target.value)}
                  value={notificationBody}
                />
                <button
                  className="button button-primary mt-3"
                  disabled={
                    !notificationTitle.trim() ||
                    !notificationBody.trim() ||
                    (notificationMode === "targeted" && !notificationRecipient)
                  }
                  onClick={async () => {
                    setNotificationError(null);
                    setNotificationResult(null);
                    try {
                      setNotificationPreview(
                        await post<NotificationPreview>(
                          currentNotification.previewPath,
                          { title: notificationTitle, body: notificationBody },
                          await token()
                        )
                      );
                    } catch {
                      setNotificationError(
                        "Could not preview notification recipients."
                      );
                    }
                  }}
                  type="button"
                >
                  Preview recipient count
                </button>
                {notificationPreview && (
                  <p className="mt-2 text-sm">
                    Eligible recipients: {notificationPreview.recipientCount}.
                    This count reflects consent/opt-out filtering at preview
                    time.
                  </p>
                )}
                {notificationError && (
                  <p className="mt-2 text-sm text-red-dark" role="alert">
                    {notificationError}
                  </p>
                )}
                <ConfirmButton
                  action={currentNotification.action}
                  disabled={
                    !notificationTitle.trim() ||
                    !notificationBody.trim() ||
                    (notificationMode === "targeted" && !notificationRecipient)
                  }
                  label="Send notification"
                  target={currentNotification.target}
                  onConfirm={async () => {
                    const result = await post<NotificationSendResult>(
                      currentNotification.sendPath,
                      {
                        action: currentNotification.action,
                        body: notificationBody,
                        confirmation: confirmationPhrase(
                          currentNotification.action,
                          currentNotification.target
                        ),
                        target: currentNotification.target,
                        title: notificationTitle,
                      },
                      await token()
                    );
                    setNotificationResult(result);
                    await loadNotifications();
                  }}
                />
                {notificationResult && (
                  <p className="mt-2 text-sm">
                    Submitted to provider: {notificationResult.acceptedCount} of{" "}
                    {notificationResult.recipientCount}; not submitted:{" "}
                    {notificationResult.notSubmittedCount}. Delivery is{" "}
                    {notificationResult.delivery}.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </AdminSection>

        <TicketLookupAdminSection
          active={activeTab === "tickets"}
          token={token}
        />

        <AdminSection
          active={activeTab === "ads"}
          description="Configure direct, contextual advertisements. Route placements are stored separately for each travel direction."
          id="ads"
          load={loadAds}
          loadingFallback={
            <AdminLoadingSkeleton label="Loading advertising settings" />
          }
          title="Advertising"
        >
          {ads ? (
            <div className="mt-4 space-y-5">
              <section className="rounded-xl border border-gray-light p-4 dark:border-gray-dark">
                <div className="flex items-center justify-between gap-4">
                  <span>
                    <strong>Show advertisements</strong>
                    <span className="mt-1 block text-sm">
                      This global switch overrides every individual placement.
                    </span>
                  </span>
                  <ToggleSwitch
                    checked={ads.adsEnabled}
                    label="Show advertisements globally"
                    onChange={(adsEnabled) => setAds({ ...ads, adsEnabled })}
                  />
                </div>
                <ConfirmButton
                  action="save-ad-settings"
                  label="Save global ad switch"
                  target="ads:global"
                  onConfirm={async () => {
                    const value = await put<AdConfiguration>(
                      "/admin/ads/global",
                      {
                        action: "save-ad-settings",
                        adsEnabled: ads.adsEnabled,
                        confirmation: confirmationPhrase(
                          "save-ad-settings",
                          "ads:global"
                        ),
                        target: "ads:global",
                      },
                      await token()
                    );
                    setAds(value);
                  }}
                />
              </section>

              <section
                className="rounded-xl border border-gray-light p-4 dark:border-gray-dark"
                id="admin-ad-placement"
              >
                <h3 className="font-semibold">Placement</h3>
                <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                  Empty or disabled placements stay hidden from riders. The
                  owner sees a dashed placeholder on the corresponding page.
                </p>
                <label
                  className="mt-3 block font-semibold"
                  htmlFor="admin-ad-slot"
                >
                  Page slot
                </label>
                <select
                  className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  id="admin-ad-slot"
                  onChange={(event) =>
                    setSelectedAdSlot(event.target.value as AdSlotId)
                  }
                  value={selectedAdSlot}
                >
                  {AD_SLOT_IDS.map((slot) => (
                    <option key={slot} value={slot}>
                      {adSlotLabels[slot]}
                    </option>
                  ))}
                </select>

                {selectedAdSlot === "home" ? null : (
                  <>
                    <label
                      className="mt-3 block font-semibold"
                      htmlFor="admin-ad-direction"
                    >
                      Travel direction
                    </label>
                    <select
                      className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                      id="admin-ad-direction"
                      onChange={(event) =>
                        setSelectedAdDirection(event.target.value)
                      }
                      value={selectedAdDirection}
                    >
                      {adDirections.map((direction) => (
                        <option key={direction.key} value={direction.key}>
                          {direction.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                {adDraft ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span>
                        <strong>Enable this placement</strong>
                        <span className="mt-1 block text-sm">
                          The global advertising switch must also be on.
                        </span>
                      </span>
                      <ToggleSwitch
                        checked={adDraft.enabled}
                        label="Enable this ad placement"
                        onChange={(enabled) =>
                          setAdDraft({ ...adDraft, enabled })
                        }
                      />
                    </div>
                    <label
                      className="block font-semibold"
                      htmlFor="admin-ad-advertiser"
                    >
                      Advertiser name
                    </label>
                    <input
                      className="w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                      id="admin-ad-advertiser"
                      onChange={(event) =>
                        setAdDraft({
                          ...adDraft,
                          advertiserName: event.target.value,
                        })
                      }
                      value={adDraft.advertiserName}
                    />
                    <label
                      className="block font-semibold"
                      htmlFor="admin-ad-headline"
                    >
                      Headline
                    </label>
                    <input
                      className="w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                      id="admin-ad-headline"
                      onChange={(event) =>
                        setAdDraft({
                          ...adDraft,
                          headline: event.target.value,
                        })
                      }
                      value={adDraft.headline}
                    />
                    <label
                      className="block font-semibold"
                      htmlFor="admin-ad-body"
                    >
                      Body
                    </label>
                    <textarea
                      className="w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                      id="admin-ad-body"
                      onChange={(event) =>
                        setAdDraft({ ...adDraft, body: event.target.value })
                      }
                      value={adDraft.body}
                    />
                    <label
                      className="block font-semibold"
                      htmlFor="admin-ad-url"
                    >
                      Destination URL
                    </label>
                    <input
                      className="w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                      id="admin-ad-url"
                      inputMode="url"
                      onChange={(event) =>
                        setAdDraft({
                          ...adDraft,
                          targetUrl: event.target.value,
                        })
                      }
                      placeholder="https://example.com/offer"
                      type="url"
                      value={adDraft.targetUrl}
                    />
                    <ConfirmButton
                      action="save-ad-settings"
                      disabled={
                        !adDraft.advertiserName.trim() ||
                        !adDraft.headline.trim() ||
                        !adDraft.targetUrl.trim()
                      }
                      label="Save ad placement"
                      target={`ad:${adDraft.key}`}
                      onConfirm={async () => {
                        const target = `ad:${adDraft.key}`;
                        const value = await put<AdConfiguration>(
                          `/admin/ads/placements/${encodeURIComponent(adDraft.key)}`,
                          {
                            ...adDraft,
                            action: "save-ad-settings",
                            confirmation: confirmationPhrase(
                              "save-ad-settings",
                              target
                            ),
                            target,
                          },
                          await token()
                        );
                        setAds(value);
                      }}
                    />
                  </div>
                ) : null}
              </section>

              {adDraft ? (
                <section className="rounded-xl border border-gray-light p-4 dark:border-gray-dark">
                  <h3 className="font-semibold">Schedule immutable campaign</h3>
                  <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                    Scheduling snapshots the placement creative and direction.
                    Later placement edits do not change campaign reports. Times
                    use America/Los_Angeles; nonexistent or ambiguous DST times
                    are rejected.
                  </p>
                  <label
                    className="mt-3 block font-semibold"
                    htmlFor="admin-ad-report-name"
                  >
                    Campaign/report name
                  </label>
                  <input
                    className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                    id="admin-ad-report-name"
                    maxLength={160}
                    onChange={(event) => setAdReportName(event.target.value)}
                    value={adReportName}
                  />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label
                      className="font-semibold"
                      htmlFor="admin-ad-starts-at"
                    >
                      Starts
                      <input
                        className="mt-1 block w-full rounded border border-gray-medium bg-white p-2 font-normal text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                        id="admin-ad-starts-at"
                        onChange={(event) => setAdStartsAt(event.target.value)}
                        type="datetime-local"
                        value={adStartsAt}
                      />
                    </label>
                    <label className="font-semibold" htmlFor="admin-ad-ends-at">
                      Ends
                      <input
                        className="mt-1 block w-full rounded border border-gray-medium bg-white p-2 font-normal text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                        id="admin-ad-ends-at"
                        onChange={(event) => setAdEndsAt(event.target.value)}
                        type="datetime-local"
                        value={adEndsAt}
                      />
                    </label>
                  </div>
                  <ConfirmButton
                    action="schedule-ad-campaign"
                    disabled={!adReportName.trim() || !adStartsAt || !adEndsAt}
                    label="Schedule campaign"
                    target={`ad-campaign:${adDraft.key}`}
                    onConfirm={async () => {
                      const target = `ad-campaign:${adDraft.key}`;
                      const campaign = await post<AdCampaign>(
                        "/admin/ads/campaigns",
                        {
                          action: "schedule-ad-campaign",
                          confirmation: confirmationPhrase(
                            "schedule-ad-campaign",
                            target
                          ),
                          endsAt: adCampaignTimestamp(adEndsAt),
                          placementKey: adDraft.key,
                          reportName: adReportName.trim(),
                          startsAt: adCampaignTimestamp(adStartsAt),
                          target,
                        },
                        await token()
                      );
                      setAdCampaigns((current) => [campaign, ...current]);
                      setAdReportName("");
                      setAdStartsAt("");
                      setAdEndsAt("");
                    }}
                  />
                </section>
              ) : null}

              <section className="rounded-xl border border-gray-light p-4 dark:border-gray-dark">
                <div>
                  <div>
                    <h3 className="font-semibold">Campaign reports</h3>
                    <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                      Aggregate informational counts only; not unique people or
                      billable delivery.
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="text-sm font-semibold">
                      Inventory start
                      <input
                        className="mt-1 block rounded border border-gray-medium bg-white p-2 font-normal text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                        onChange={(event) =>
                          setAdInventoryStartDate(event.target.value)
                        }
                        type="date"
                        value={adInventoryStartDate}
                      />
                    </label>
                    <label className="text-sm font-semibold">
                      Inventory end
                      <input
                        className="mt-1 block rounded border border-gray-medium bg-white p-2 font-normal text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                        onChange={(event) =>
                          setAdInventoryEndDate(event.target.value)
                        }
                        type="date"
                        value={adInventoryEndDate}
                      />
                    </label>
                    <button
                      className="button button-secondary"
                      disabled={adInventoryLoading}
                      onClick={() =>
                        loadAdInventoryReport().catch(() => undefined)
                      }
                      type="button"
                    >
                      {adInventoryLoading
                        ? "Loading charts…"
                        : "Refresh charts"}
                    </button>
                  </div>
                </div>
                {adInventoryError ? (
                  <p className="mt-3 text-sm text-red-dark" role="alert">
                    {adInventoryError}
                  </p>
                ) : null}
                {adInventoryReport ? (
                  <>
                    <AdInventoryCharts
                      loading={adInventoryLoading}
                      onSelectPlacement={selectAdInventoryPlacement}
                      report={adInventoryReport}
                      selectedPlacementKey={adInventoryPlacementKey}
                      terminals={adTerminals}
                    />
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer font-semibold">
                        Daily placement rows
                      </summary>
                      <div className="mt-2 max-h-96 overflow-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Placement/direction</th>
                              <th>Opportunities</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adInventoryReport.daily
                              .filter(
                                (row) =>
                                  !adInventoryPlacementKey ||
                                  row.placementKey === adInventoryPlacementKey
                              )
                              .map((row) => (
                                <tr
                                  key={`${row.businessDate}:${row.placementKey}`}
                                >
                                  <td>{row.businessDate}</td>
                                  <td>{row.placementKey}</td>
                                  <td>{row.opportunityCount}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </>
                ) : null}
                <ul className="mt-4 space-y-3">
                  {adCampaigns
                    .filter(
                      (campaign) =>
                        !adDraft || campaign.placementKey === adDraft.key
                    )
                    .map((campaign) => {
                      const ended =
                        Boolean(campaign.endedEarlyAt) ||
                        new Date(campaign.endsAt) <= new Date();
                      return (
                        <li
                          className="rounded border border-gray-light p-3 dark:border-gray-dark"
                          key={campaign.id}
                        >
                          <strong>{campaign.reportName}</strong>
                          <p className="mt-1 text-sm">
                            {campaign.advertiserName} · {campaign.placementKey}
                          </p>
                          <p className="text-xs text-gray-dark dark:text-gray-light">
                            {formatAdCampaignTime(campaign.startsAt)} –{" "}
                            {formatAdCampaignTime(campaign.endsAt)}
                            {campaign.endedEarlyAt
                              ? ` · ended ${formatAdCampaignTime(campaign.endedEarlyAt)}`
                              : ""}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              className="button button-secondary button-small"
                              onClick={() =>
                                loadAdCampaignReport(campaign.id).catch(
                                  () => undefined
                                )
                              }
                              type="button"
                            >
                              View report
                            </button>
                            <button
                              className="button button-secondary button-small"
                              onClick={() =>
                                downloadAdCampaignCsv(campaign.id).catch(
                                  () => undefined
                                )
                              }
                              type="button"
                            >
                              Download CSV
                            </button>
                            {ended ? null : (
                              <ConfirmButton
                                action="end-ad-campaign"
                                buttonClassName="button button-small border-red-dark bg-transparent text-red-dark"
                                label="End now"
                                target={`ad-campaign:${campaign.id}:end`}
                                onConfirm={async () => {
                                  const target = `ad-campaign:${campaign.id}:end`;
                                  const updated = await post<AdCampaign>(
                                    `/admin/ads/campaigns/${campaign.id}/end`,
                                    {
                                      action: "end-ad-campaign",
                                      confirmation: confirmationPhrase(
                                        "end-ad-campaign",
                                        target
                                      ),
                                      target,
                                    },
                                    await token()
                                  );
                                  setAdCampaigns((current) =>
                                    current.map((item) =>
                                      item.id === updated.id ? updated : item
                                    )
                                  );
                                }}
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                </ul>

                {adCampaignReport ? (
                  <div className="mt-5 rounded border border-gray-light p-3 dark:border-gray-dark">
                    <h4 className="font-semibold">
                      {adCampaignReport.campaign.reportName}
                    </h4>
                    <p className="mt-2 text-sm">
                      Opportunities: {adCampaignReport.totals.opportunityCount};{" "}
                      served: {adCampaignReport.totals.servedCount}; viewable:{" "}
                      {adCampaignReport.totals.viewableCount} (
                      {adCampaignReport.totals.viewabilityRate ?? "—"}); clicks:{" "}
                      {adCampaignReport.totals.clickCount} (
                      {adCampaignReport.totals.clickThroughRate ?? "—"}).
                    </p>
                    <p className="mt-2 text-xs text-gray-dark dark:text-gray-light">
                      {adCampaignReport.methodology}
                    </p>
                    <div className="mt-3 overflow-x-auto text-sm">
                      <table className="w-full text-left">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Opportunities</th>
                            <th>Served</th>
                            <th>Viewable</th>
                            <th>Clicks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adCampaignReport.daily.map((row) => (
                            <tr key={row.businessDate}>
                              <td>{row.businessDate}</td>
                              <td>{row.opportunityCount}</td>
                              <td>{row.servedCount}</td>
                              <td>{row.viewableCount}</td>
                              <td>{row.clickCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <ConfirmButton
                      action="create-ad-report-share"
                      label="Create advertiser report link"
                      target={`ad-campaign:${adCampaignReport.campaign.id}:share`}
                      onConfirm={async () => {
                        const target = `ad-campaign:${adCampaignReport.campaign.id}:share`;
                        const created = await post<AdReportShareCreated>(
                          `/admin/ads/campaigns/${adCampaignReport.campaign.id}/shares`,
                          {
                            action: "create-ad-report-share",
                            confirmation: confirmationPhrase(
                              "create-ad-report-share",
                              target
                            ),
                            target,
                          },
                          await token()
                        );
                        setCreatedAdReportShare(created);
                        setAdReportShares((current) => [created, ...current]);
                      }}
                    />
                    {createdAdReportShare ? (
                      <label className="mt-3 block text-sm">
                        Copy this link now; the secret is not stored in readable
                        form.
                        <input
                          className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                          readOnly
                          value={createdAdReportShare.url}
                        />
                      </label>
                    ) : null}
                    <ul className="mt-3 space-y-2 text-sm">
                      {adReportShares.map((share) => (
                        <li
                          className="flex flex-wrap items-center justify-between gap-2"
                          key={share.id}
                        >
                          <span>
                            Created {new Date(share.createdAt).toLocaleString()}{" "}
                            · {share.revokedAt ? "revoked" : "active"}
                          </span>
                          {share.revokedAt ? null : (
                            <ConfirmButton
                              action="revoke-ad-report-share"
                              buttonClassName="button button-small border-red-dark bg-transparent text-red-dark"
                              label="Revoke"
                              target={`ad-report-share:${share.id}`}
                              onConfirm={async () => {
                                const target = `ad-report-share:${share.id}`;
                                const revoked =
                                  await post<AdReportShareSummary>(
                                    `/admin/ads/shares/${share.id}/revoke`,
                                    {
                                      action: "revoke-ad-report-share",
                                      confirmation: confirmationPhrase(
                                        "revoke-ad-report-share",
                                        target
                                      ),
                                      target,
                                    },
                                    await token()
                                  );
                                setAdReportShares((current) =>
                                  current.map((item) =>
                                    item.id === revoked.id ? revoked : item
                                  )
                                );
                              }}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
        </AdminSection>

        <AdminSection
          active={activeTab === "content"}
          description="Manage public maintenance, crawler, leaderboard discovery, and announcements."
          id="content"
          load={loadContent}
          loadingFallback={
            <AdminLoadingSkeleton label="Loading content and SEO" />
          }
          title="Content and SEO"
        >
          {content ? (
            <div className="mt-4 space-y-5">
              <div>
                <label
                  className="block font-semibold"
                  htmlFor="maintenance-message"
                >
                  Maintenance message
                </label>
                <textarea
                  className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  id="maintenance-message"
                  onChange={(event) =>
                    setMaintenanceMessage(event.target.value)
                  }
                  value={maintenanceMessage}
                />
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span>Show maintenance banner</span>
                  <ToggleSwitch
                    checked={content.maintenance.enabled}
                    label="Show maintenance banner"
                    onChange={(enabled) =>
                      setContent({
                        ...content,
                        maintenance: { ...content.maintenance, enabled },
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-4">
                  <span>Index leaderboards</span>
                  <ToggleSwitch
                    checked={content.leaderboardIndexingEnabled}
                    label="Index leaderboards"
                    onChange={(leaderboardIndexingEnabled) =>
                      setContent({ ...content, leaderboardIndexingEnabled })
                    }
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span>Enable leaderboard sharing</span>
                  <ToggleSwitch
                    checked={content.leaderboardSharingEnabled}
                    label="Enable leaderboard sharing"
                    onChange={(leaderboardSharingEnabled) =>
                      setContent({ ...content, leaderboardSharingEnabled })
                    }
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-4">
                  <span>Allow AI crawlers</span>
                  <ToggleSwitch
                    checked={content.crawlerPolicy.aiCrawlers === "allow"}
                    label="Allow AI crawlers"
                    onChange={(allow) =>
                      setContent({
                        ...content,
                        crawlerPolicy: {
                          ...content.crawlerPolicy,
                          aiCrawlers: allow ? "allow" : "disallow",
                        },
                      })
                    }
                  />
                </div>
              </div>
              <ConfirmButton
                action="save-site-settings"
                label="Save site settings"
                target="site:settings"
                onConfirm={async () => {
                  const value = await put<
                    Pick<
                      Content,
                      | "crawlerPolicy"
                      | "leaderboardIndexingEnabled"
                      | "leaderboardSharingEnabled"
                      | "maintenance"
                    >
                  >(
                    "/admin/content/settings",
                    {
                      action: "save-site-settings",
                      confirmation: confirmationPhrase(
                        "save-site-settings",
                        "site:settings"
                      ),
                      crawlerPolicy: content.crawlerPolicy,
                      leaderboardIndexingEnabled:
                        content.leaderboardIndexingEnabled,
                      leaderboardSharingEnabled:
                        content.leaderboardSharingEnabled,
                      maintenance: {
                        ...content.maintenance,
                        message: maintenanceMessage,
                      },
                      target: "site:settings",
                    },
                    await token()
                  );
                  setContent({ ...content, ...value });
                  setMaintenanceMessage(value.maintenance.message);
                }}
              />
              <section className="rounded-xl border border-gray-light p-4 dark:border-gray-dark">
                <h3 className="font-semibold">Create announcement</h3>
                <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                  Create a short plain-text service notice. Published
                  announcements appear in the public Service notices area; leave
                  Publish immediately off to create a private draft.
                </p>
                <label
                  className="mt-2 block font-semibold"
                  htmlFor="announcement-title"
                >
                  Title
                </label>
                <input
                  className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  id="announcement-title"
                  onChange={(event) => setAnnouncementTitle(event.target.value)}
                  value={announcementTitle}
                />
                <label
                  className="mt-2 block font-semibold"
                  htmlFor="announcement-body"
                >
                  Body
                </label>
                <textarea
                  className="mt-1 w-full rounded border border-gray-medium bg-white p-2 text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  id="announcement-body"
                  onChange={(event) => setAnnouncementBody(event.target.value)}
                  value={announcementBody}
                />
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span>Publish immediately</span>
                  <ToggleSwitch
                    checked={announcementPublished}
                    label="Publish immediately"
                    onChange={setAnnouncementPublished}
                  />
                </div>
                <ConfirmButton
                  action="publish-announcement"
                  disabled={
                    !announcementTitle.trim() || !announcementBody.trim()
                  }
                  label="Create announcement"
                  target="announcement:new"
                  onConfirm={async () => {
                    await post(
                      "/admin/content/announcements",
                      {
                        action: "publish-announcement",
                        body: announcementBody,
                        confirmation: confirmationPhrase(
                          "publish-announcement",
                          "announcement:new"
                        ),
                        published: announcementPublished,
                        target: "announcement:new",
                        title: announcementTitle,
                      },
                      await token()
                    );
                    setAnnouncementTitle("");
                    setAnnouncementBody("");
                    setAnnouncementPublished(false);
                    await loadContent();
                  }}
                />
              </section>
              <div>
                <h3 className="font-semibold">Existing announcements</h3>
                {content.announcements.length === 0 ? (
                  <p className="text-sm">No announcements exist.</p>
                ) : (
                  <ul className="mt-2 text-sm">
                    {content.announcements.map((announcement) => (
                      <li key={announcement.id}>
                        {announcement.published ? "Published" : "Draft"}:{" "}
                        {announcement.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </AdminSection>
      </div>
    </Page>
  );
};
