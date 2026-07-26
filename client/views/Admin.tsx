import { useAuth0 } from "@auth0/auth0-react";
import React, { ReactElement, ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import type {
  AdminConfirmationAction,
  AdminUserList,
  AdminUserListItem,
} from "shared/contracts/admin";

import { Page } from "~/components/Page";
import { confirmationPhrase } from "~/lib/adminConfirmation";
import { del, get, post, put } from "~/lib/api";

const ADMIN_EMAIL = "anstosa@gmail.com";

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
      useFullName: boolean;
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
type AdminTab = "access" | "users" | "operations" | "notifications" | "content";

const adminTabs: { id: AdminTab; label: string }[] = [
  { id: "access", label: "Access" },
  { id: "users", label: "Users" },
  { id: "operations", label: "Data operations" },
  { id: "notifications", label: "Notifications" },
  { id: "content", label: "Content & SEO" },
];

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

const AdminSection = ({
  active,
  children,
  description,
  id,
  load,
  title,
}: {
  active: boolean;
  children: ReactNode;
  description: string;
  id: string;
  load?: () => Promise<void>;
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
  }, [active, load, loaded, title]);

  if (!active) {
    return null;
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
      {error && <p className="mt-3 text-sm text-red-dark">{error}</p>}
      {!error && children}
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

export const Admin = (): ReactElement => {
  const { getAccessTokenSilently, isAuthenticated, user } = useAuth0();
  const [activeTab, setActiveTab] = useState<AdminTab>("access");
  const [features, setFeatures] = useState<FeatureSettings | null>(null);
  const [detailedFeature, setDetailedFeature] =
    useState<DetailedFeatureSettings | null>(null);
  const [allowlistText, setAllowlistText] = useState("");
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [notifications, setNotifications] =
    useState<NotificationDashboard | null>(null);
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

  if (!isAuthenticated || user?.email !== ADMIN_EMAIL) {
    return <Navigate replace to="/" />;
  }

  const currentNotification = notificationRequest(
    notificationMode,
    user?.sub ?? "",
    notificationRecipient?.subject ?? ""
  );
  const token = (): Promise<string> => getAccessTokenSilently();
  const loadFeatures = async (): Promise<void> => {
    const accessToken = await token();
    const [legacy, detailed] = await Promise.all([
      get<FeatureSettings>("/admin/features", accessToken),
      get<DetailedFeatureSettings>("/admin/features/leaderboards", accessToken),
    ]);
    setFeatures(legacy);
    setDetailedFeature(detailed);
    setAllowlistText(detailed.subjects.join("\n"));
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
  const saveDetailedFeature = async (): Promise<void> => {
    if (!detailedFeature) {
      return;
    }
    setFeatureError(null);
    try {
      const value = await put<DetailedFeatureSettings>(
        "/admin/features/leaderboards",
        {
          enabled: detailedFeature.enabled,
          subjects: allowlistText.split(/\s+/).filter(Boolean),
        },
        await token()
      );
      setDetailedFeature(value);
      setAllowlistText(value.subjects.join("\n"));
    } catch {
      setFeatureError("Could not save private feature access.");
    }
  };
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
          description="Control public leaderboard availability, a server-enforced emergency kill switch, and explicit private subject access. Automatic check-ins remain disabled."
          id="access"
          load={loadFeatures}
          title="Feature flags"
        >
          {features && detailedFeature ? (
            <div className="mt-4 space-y-4">
              <label className="flex items-center justify-between gap-4">
                <span>
                  <strong>Leaderboards</strong>
                  <span className="mt-1 block text-sm">
                    Enable public leaderboard pages and manual check-ins.
                  </span>
                </span>
                <ToggleSwitch
                  checked={detailedFeature.enabled}
                  label="Enable leaderboards"
                  onChange={(enabled) =>
                    setDetailedFeature({ ...detailedFeature, enabled })
                  }
                />
              </label>
              <div>
                <label
                  className="block font-semibold"
                  htmlFor="leaderboard-allowlist"
                >
                  Private subject allowlist
                </label>
                <p className="mt-1 text-sm">
                  One exact Auth0 subject per line. These grants apply only
                  while public leaderboards are disabled and never override the
                  kill switch.
                </p>
                <textarea
                  aria-label="Leaderboard subject allowlist"
                  className="mt-2 w-full rounded border border-gray-medium bg-white p-2 text-sm text-gray-900 dark:bg-blue-darkest dark:text-gray-100"
                  id="leaderboard-allowlist"
                  onChange={(event) => setAllowlistText(event.target.value)}
                  value={allowlistText}
                />
                <button
                  className="button button-primary mt-3"
                  onClick={saveDetailedFeature}
                  type="button"
                >
                  Save feature access
                </button>
              </div>
              <p className="text-sm">
                Emergency kill switch:{" "}
                <strong>
                  {detailedFeature.killSwitch ? "active" : "inactive"}
                </strong>
                . It disables public and allowlisted access immediately.
              </p>
              <ConfirmButton
                action="set-feature-kill-switch"
                buttonClassName={
                  detailedFeature.killSwitch
                    ? "button button-primary mt-3"
                    : "button mt-3 border-red-dark bg-transparent text-red-dark hover:bg-red-dark hover:text-white"
                }
                label={
                  detailedFeature.killSwitch
                    ? "Disable leaderboard kill switch"
                    : "Enable leaderboard kill switch"
                }
                target="feature:leaderboards:kill-switch"
                onConfirm={async () => {
                  const value = await put<DetailedFeatureSettings>(
                    "/admin/features/leaderboards/kill-switch",
                    {
                      action: "set-feature-kill-switch",
                      confirmation: confirmationPhrase(
                        "set-feature-kill-switch",
                        "feature:leaderboards:kill-switch"
                      ),
                      enabled: !detailedFeature.killSwitch,
                      target: "feature:leaderboards:kill-switch",
                    },
                    await token()
                  );
                  setDetailedFeature(value);
                }}
              />
              {featureError && (
                <p className="text-sm text-red-dark">{featureError}</p>
              )}
            </div>
          ) : (
            <p className="mt-3">Loading…</p>
          )}
        </AdminSection>

        <AdminSection
          active={activeTab === "users"}
          description="Search the owner-only Auth0 directory, then select one user to load their Ferry FYI support data."
          id="users"
          load={loadUserDirectory}
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
            ) : (
              <p className="text-sm">Loading user directory…</p>
            )}
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
                          ; full name:{" "}
                          {userProfile.leaderboard.profile.useFullName
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
          ) : (
            <p className="mt-3">Loading…</p>
          )}
        </AdminSection>

        <AdminSection
          active={activeTab === "notifications"}
          description="Pause all sends at the final policy boundary, or preview and send a one-off notification only to consenting recipients. Provider acceptance is never delivery confirmation."
          id="notifications"
          load={loadNotifications}
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
          ) : (
            <p className="mt-3">Loading…</p>
          )}
        </AdminSection>

        <AdminSection
          active={activeTab === "content"}
          description="Manage public maintenance, crawler, leaderboard discovery, and announcements."
          id="content"
          load={loadContent}
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
          ) : (
            <p className="mt-3">Loading…</p>
          )}
        </AdminSection>
      </div>
    </Page>
  );
};
