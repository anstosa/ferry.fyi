import { useAuth0 } from "@auth0/auth0-react";
import React, { ReactElement, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { Page } from "~/components/Page";
import { get, put } from "~/lib/api";

const ADMIN_EMAIL = "anstosa@gmail.com";

export const Admin = (): ReactElement => {
  const { getAccessTokenSilently, isAuthenticated, user } = useAuth0();
  const [enabled, setEnabled] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [savedAutomatic, setSavedAutomatic] = useState(false);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || user?.email !== ADMIN_EMAIL) {
      return;
    }
    getAccessTokenSilently()
      .then((token) => get("/admin/features", token))
      .then((value) => {
        const featureSettings = value as {
          automaticLeaderboardCheckinsEnabled: boolean;
          leaderboardsEnabled: boolean;
        };
        setEnabled(featureSettings.leaderboardsEnabled);
        setSavedEnabled(featureSettings.leaderboardsEnabled);
        setAutomatic(featureSettings.automaticLeaderboardCheckinsEnabled);
        setSavedAutomatic(featureSettings.automaticLeaderboardCheckinsEnabled);
      })
      .catch(() => setError("Could not load admin settings."))
      .finally(() => setLoading(false));
  }, [getAccessTokenSilently, isAuthenticated, user?.email]);

  if (!isAuthenticated || user?.email !== ADMIN_EMAIL) {
    return <Navigate replace to="/" />;
  }

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessTokenSilently();
      const value = await put<{
        automaticLeaderboardCheckinsEnabled: boolean;
        leaderboardsEnabled: boolean;
      }>(
        "/admin/features",
        {
          automaticLeaderboardCheckinsEnabled: automatic,
          leaderboardsEnabled: enabled,
        },
        token
      );
      setEnabled(value.leaderboardsEnabled);
      setSavedEnabled(value.leaderboardsEnabled);
      setAutomatic(value.automaticLeaderboardCheckinsEnabled);
      setSavedAutomatic(value.automaticLeaderboardCheckinsEnabled);
    } catch {
      setError("Could not save admin settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="Admin">
      <section className="mt-4 max-w-xl rounded-2xl border border-gray-light bg-white p-4 dark:border-gray-dark dark:bg-blue-dark">
        <h2 className="font-bold text-lg">Feature flags</h2>
        {loading ? (
          <p className="mt-3">Loading…</p>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-bold">Leaderboards</h3>
                <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                  Enable leaderboard pages and check-ins for everyone.
                </p>
              </div>
              <button
                aria-checked={enabled}
                aria-label="Enable leaderboards"
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${enabled ? "bg-green-dark" : "bg-gray-medium"}`}
                onClick={() => setEnabled((current) => !current)}
                role="switch"
                type="button"
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${enabled ? "left-6" : "left-1"}`}
                />
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-bold">Automatic check-ins</h3>
                <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                  Keep off for a manual check-in-only launch.
                </p>
              </div>
              <button
                aria-checked={automatic}
                aria-label="Enable automatic check-ins"
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${automatic ? "bg-green-dark" : "bg-gray-medium"}`}
                disabled={!enabled}
                onClick={() => setAutomatic((current) => !current)}
                role="switch"
                type="button"
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${automatic ? "left-6" : "left-1"}`}
                />
              </button>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              {error ? (
                <p className="text-sm text-red-dark">{error}</p>
              ) : (
                <span />
              )}
              <button
                className="button button-primary"
                disabled={
                  saving ||
                  (enabled === savedEnabled && automatic === savedAutomatic)
                }
                onClick={() => save()}
                type="button"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </section>
    </Page>
  );
};
