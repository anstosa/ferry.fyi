import { Capacitor } from "@capacitor/core";
import { DateTime } from "luxon";
import React, { type ReactElement, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useSupporter } from "~/lib/supporterContext";
import { useUser } from "~/lib/user";

// format one paid-through date
const getActiveUntilLabel = (value: string | null): string | null => {
  // date availability guard
  if (!value) {
    return null;
  }
  const date = DateTime.fromISO(value);
  // valid date guard
  return date.isValid ? date.toLocaleString(DateTime.DATE_MED) : null;
};

// label one storefront source
const getStoreLabel = (store: string): string => {
  // apple source guard
  if (store === "app_store") {
    return "App Store";
  }
  // google source guard
  if (store === "play_store") {
    return "Google Play";
  }
  // web source guard
  if (store === "rc_billing") {
    return "Ferry FYI website";
  }
  return "subscription provider";
};

/** Account-bound Supporter purchase and status surface. */
export const SupporterCard = (): ReactElement => {
  const [userState] = useUser();
  const supporter = useSupporter();
  const [notice, setNotice] = useState<string | null>(null);
  const loadedSubject = useRef<string | null>(null);
  const platform = Capacitor.getPlatform();
  const activeUntil = getActiveUntilLabel(
    supporter.status?.activeUntil ?? null
  );

  // load billing identity only on this surface
  useEffect(() => {
    const subject = userState.user?.user_id ?? null;
    // signed-out reset guard
    if (!subject) {
      loadedSubject.current = null;
      return;
    }
    // one load per account guard
    if (loadedSubject.current === subject) {
      return;
    }
    loadedSubject.current = subject;
    supporter.refresh().catch(() => undefined);
  }, [supporter.refresh, userState.user?.user_id]);

  // start one selected purchase
  const purchase = async (interval: "month" | "year"): Promise<void> => {
    setNotice(null);
    // isolate purchase status copy
    try {
      const result = await supporter.purchase(interval);
      // cancelled purchase guard
      if (result?.outcome === "cancelled") {
        return;
      }
      setNotice(
        result?.outcome === "purchased"
          ? "Thank you for supporting Ferry FYI. Your ad-free access is active."
          : "Purchase received. Ferry FYI is verifying your access."
      );
    } catch {
      // provider owns actionable error copy
    }
  };

  // restore current native purchases
  const restore = async (): Promise<void> => {
    setNotice(null);
    // isolate restore status copy
    try {
      await supporter.restore();
      setNotice("Purchases restored and verified for this Ferry FYI account.");
    } catch {
      // provider owns actionable error copy
    }
  };

  return (
    <section className="rounded-2xl bg-white p-6 shadow dark:bg-black">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-green-dark dark:text-green-light">
            Ferry FYI Supporter
          </p>
          <h2 className="mt-1 text-2xl font-black">
            Support an independent ferry app
          </h2>
        </div>
        {supporter.status?.active && (
          <span className="rounded-full bg-green-lightest px-3 py-1 text-sm font-bold text-green-dark dark:bg-green-dark dark:text-green-lightest">
            Active Supporter
          </span>
        )}
      </div>

      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
        <li>No Ferry FYI advertisements while signed in</li>
        <li>Optional Supporter badge on public leaderboards</li>
        <li>
          Helps fund schedules, alerts, forecasts, cameras, and ticket tools
        </li>
      </ul>
      <p className="mt-3 text-xs text-gray-dark dark:text-gray-light">
        Core ferry information, tickets, alerts, and manual check-ins remain
        free. Automatic check-ins are not yet a paid benefit.
      </p>

      {!userState.isAuthenticated && (
        <div className="mt-5">
          <Link className="button button-primary" to="/login">
            Sign in to subscribe
          </Link>
        </div>
      )}

      {userState.isAuthenticated && supporter.isLoading && (
        <p aria-live="polite" className="mt-5 text-sm">
          Loading current plans…
        </p>
      )}

      {supporter.status?.active && (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl bg-green-lightest p-4 text-sm text-green-dark dark:bg-green-dark dark:text-green-lightest">
            <p className="font-bold">Your ad-free experience is active.</p>
            {activeUntil && (
              <p className="mt-1">
                Current access is verified through {activeUntil}.
              </p>
            )}
            {supporter.status.sources.map((source) => (
              <p
                className="mt-1"
                key={`${source.store}:${source.productIdentifier}`}
              >
                {getStoreLabel(source.store)} ·{" "}
                {source.willRenew ? "renews" : "does not renew"}
              </p>
            ))}
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              checked={supporter.status.supporterBadgeVisible}
              className="mt-1"
              disabled={supporter.isBusy}
              onChange={(event) =>
                supporter
                  .setBadgeVisible(event.target.checked)
                  .catch(() => undefined)
              }
              type="checkbox"
            />
            <span>
              Show my Supporter badge on public leaderboards. This is off by
              default and never shows plan, price, or renewal details.
            </span>
          </label>
          <button
            className="button button-outline"
            disabled={supporter.isBusy}
            onClick={() => supporter.manage().catch(() => undefined)}
            type="button"
          >
            Manage subscription
          </button>
        </div>
      )}

      {userState.isAuthenticated &&
        supporter.status &&
        !supporter.status.active &&
        !supporter.isLoading && (
          <div className="mt-5">
            {supporter.products.length === 2 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {supporter.products.map((product) => (
                  <button
                    className="rounded-xl border-2 border-green-dark p-4 text-left transition hover:bg-green-lightest disabled:opacity-60 dark:border-green-light dark:hover:bg-green-dark"
                    disabled={supporter.isBusy}
                    key={product.interval}
                    onClick={() => purchase(product.interval)}
                    type="button"
                  >
                    <span className="block text-lg font-black">
                      {product.interval === "month" ? "Monthly" : "Yearly"}
                    </span>
                    <span className="mt-1 block text-xl font-bold">
                      {product.price}/
                      {product.interval === "month" ? "month" : "year"}
                    </span>
                    {product.interval === "year" && (
                      <span className="mt-1 block text-xs font-semibold">
                        About 33% less than twelve monthly payments
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm">
                Subscription checkout is not available on this app version or
                platform yet.
              </p>
            )}
            {platform !== "web" && (
              <button
                className="button button-outline mt-3"
                disabled={supporter.isBusy}
                onClick={restore}
                type="button"
              >
                Restore purchases
              </button>
            )}
            <p className="mt-4 text-xs leading-relaxed text-gray-dark dark:text-gray-light">
              Subscriptions renew automatically until cancelled. Cancel through
              the store or billing portal that processed your purchase. Access
              normally continues through the paid period. On the US website,
              applicable tax may be added. By subscribing, you agree to the{" "}
              <Link className="link" to="/terms">
                Terms
              </Link>{" "}
              and{" "}
              <Link className="link" to="/privacy">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        )}

      {(supporter.error || notice) && (
        <p
          aria-live="polite"
          className="mt-4 rounded-xl bg-gray-lightest p-3 text-sm dark:bg-gray-darkest"
        >
          {notice ?? supporter.error}
        </p>
      )}
    </section>
  );
};
