import { useAuth0 } from "@auth0/auth0-react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import clsx from "clsx";
import { DateTime } from "luxon";
import React, {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import type {
  SupporterProductOption,
  SupporterSource,
} from "shared/contracts/supporter";

import { getConfiguredAuth0RedirectUri, loginWithAppFlow } from "~/lib/auth";
import { useSupporter } from "~/lib/supporterContext";
import { useUser } from "~/lib/user";
import CheckIcon from "~/static/images/icons/solid/check.svg";

import { ToggleSwitch } from "./ToggleSwitch";

interface Props {
  embedded?: boolean;
  onPurchaseStateChange?: (state: SupporterPurchaseState) => void;
}

export type SupporterPurchaseState = "purchased" | "verification_pending";

interface BenefitProps {
  children: ReactNode;
}

interface PurchaseDisclosureCopy {
  management: string;
  payment: string;
  restore: string | null;
}

/** Renders one plain checkmark benefit. */
const SupporterBenefit = ({ children }: BenefitProps): ReactElement => (
  <li className="flex items-start gap-3 text-left text-sm font-semibold leading-relaxed text-gray-darkest dark:text-white">
    <CheckIcon
      aria-hidden
      className="mt-1 h-3.5 w-3.5 shrink-0 fill-green-dark dark:fill-green-light"
    />
    <span>{children}</span>
  </li>
);

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

// label one source renewal
const getSourceRenewalLabel = (source: SupporterSource): string => {
  const sourceActiveUntil = getActiveUntilLabel(source.activeUntil);
  // renewing source guard
  if (source.willRenew) {
    return sourceActiveUntil ? `renews ${sourceActiveUntil}` : "renews";
  }
  return sourceActiveUntil
    ? `access through ${sourceActiveUntil}`
    : "does not renew";
};

/** Finds one localized product price. */
const getProductPrice = (
  products: SupporterProductOption[],
  interval: SupporterProductOption["interval"]
): string | null => {
  // scan current product options
  for (const product of products) {
    // matching interval guard
    if (product.interval === interval) {
      return product.price;
    }
  }
  return null;
};

/** Selects storefront billing language. */
const getPurchaseDisclosureCopy = (
  platform: string
): PurchaseDisclosureCopy => {
  // apple billing guard
  if (platform === "ios") {
    return {
      management:
        "Manage or cancel your subscription in App Store subscription settings.",
      payment: "Payment is charged to your Apple Account when you confirm.",
      restore: "existing subscribers can use Restore Purchases.",
    };
  }
  // google billing guard
  if (platform === "android") {
    return {
      management:
        "Manage or cancel your subscription in Google Play subscription settings.",
      payment:
        "Payment is charged to your Google Play account when you confirm.",
      restore: "existing subscribers can use Restore Purchases.",
    };
  }
  return {
    management:
      "Manage or cancel your subscription through the Ferry FYI billing portal.",
    payment:
      "Payment is charged by Ferry FYI's billing provider when you confirm.",
    restore: null,
  };
};

/** Account-bound Supporter purchase and status surface. */
export const SupporterCard = ({
  embedded = false,
  onPurchaseStateChange,
}: Props): ReactElement => {
  const { loginWithPopup, loginWithRedirect } = useAuth0();
  const [userState] = useUser();
  const supporter = useSupporter();
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<"month" | "year">(
    "year"
  );
  const loadedSubject = useRef<string | null>(null);
  const platform = Capacitor.getPlatform();
  const monthlyPrice = getProductPrice(supporter.products, "month");
  const yearlyPrice = getProductPrice(supporter.products, "year");
  const purchaseDisclosure = getPurchaseDisclosureCopy(platform);
  // describe only verified storefront prices
  const renewalPriceCopy =
    monthlyPrice && yearlyPrice
      ? ` at the selected storefront price—${monthlyPrice} each month or ${yearlyPrice} each year—`
      : " ";
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

  // start the normal auth0 login
  const signIn = async (): Promise<void> => {
    const options = {
      appState: { redirectPath: "/supporter" },
      authorizationParams: {
        redirect_uri: getConfiguredAuth0RedirectUri(platform),
      },
    };
    // android browser login
    if (platform === "android") {
      await loginWithRedirect({
        ...options,
        // native browser launcher
        openUrl: async (url) => {
          await Browser.open({ url });
        },
      });
      return;
    }
    await loginWithAppFlow({
      loginWithPopup,
      loginWithRedirect,
      options,
    });
  };

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
      // missing purchase result guard
      if (!result) {
        return;
      }
      // hand full-page results to the route
      if (onPurchaseStateChange) {
        onPurchaseStateChange(result.outcome);
        return;
      }
      setNotice(
        result.outcome === "purchased"
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
    <section
      className={clsx(
        embedded ? "mt-7" : "rounded-2xl bg-white p-6 shadow dark:bg-black"
      )}
    >
      {/* keep the account card self-contained */}
      {!embedded && (
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
      )}

      {/* center active status inside the branded page */}
      {embedded && supporter.status?.active && (
        <span className="inline-flex rounded-full bg-green-lightest px-4 py-1.5 text-sm font-bold text-green-dark dark:bg-green-dark dark:text-green-lightest">
          Active Supporter
        </span>
      )}

      {/* list supporter benefits vertically */}
      <ul
        className={clsx(
          "flex flex-col gap-3 text-left",
          embedded ? supporter.status?.active && "mt-5" : "mt-4"
        )}
      >
        <SupporterBenefit>
          No Ferry FYI advertisements while signed in
        </SupporterBenefit>
        <SupporterBenefit>
          Optional Supporter badge on public leaderboards
        </SupporterBenefit>
        <SupporterBenefit>
          Helps fund schedules, alerts, forecasts, cameras, and ticket tools
        </SupporterBenefit>
      </ul>

      <p
        className={clsx(
          "text-xs text-gray-dark dark:text-gray-light",
          embedded ? "mt-5 leading-relaxed" : "mt-3"
        )}
      >
        Core ferry information, tickets, alerts, and manual check-ins remain
        free.
      </p>

      {/* signed-out subscription entry */}
      {!userState.isAuthenticated && (
        <div className="mt-6">
          {/* preserve the ios password-only auth flow */}
          {platform === "ios" ? (
            <Link
              className={clsx(
                "button button-primary h-14 text-base shadow-lg",
                embedded && "w-full"
              )}
              to="/login"
            >
              Sign in to subscribe
            </Link>
          ) : (
            <button
              className={clsx(
                "button button-primary h-14 text-base shadow-lg",
                embedded && "w-full"
              )}
              onClick={() => signIn().catch(() => undefined)}
              type="button"
            >
              Sign in to subscribe
            </button>
          )}
        </div>
      )}

      {/* authenticated plan loading */}
      {userState.isAuthenticated && supporter.isLoading && (
        <div
          aria-live="polite"
          className="mt-6 flex items-center justify-center gap-3 rounded-2xl bg-green-50 p-4 font-bold text-green-dark dark:bg-white/10 dark:text-green-light"
        >
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-pulse rounded-full bg-green-light"
          />
          Loading current plans…
        </div>
      )}

      {/* active subscription management */}
      {supporter.status?.active && (
        <div className="mt-6 space-y-4 text-left">
          <div className="rounded-2xl bg-green-lightest p-5 text-sm text-green-dark dark:bg-green-dark dark:text-green-lightest">
            <p className="font-bold">
              {supporter.status.adsEnabled
                ? "You have chosen to see Ferry FYI advertisements."
                : "Your ad-free experience is active."}
            </p>
            {activeUntil && (
              <p className="mt-1">
                Current access is verified through {activeUntil}.
              </p>
            )}
            {/* list verified subscription sources */}
            {supporter.status.sources.map((source) => (
              <p
                className="mt-1"
                key={`${source.store}:${source.productIdentifier}`}
              >
                {getStoreLabel(source.store)} · {getSourceRenewalLabel(source)}
              </p>
            ))}
          </div>
          {/* keep ad controls on the account page */}
          {!embedded && (
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-gray-light p-4 dark:border-gray-dark">
              <div>
                <p className="font-bold">Show Ferry FYI advertisements</p>
                <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
                  Support local advertisers too. You can turn ads off again at
                  any time while subscribed.
                </p>
              </div>
              <ToggleSwitch
                checked={supporter.status.adsEnabled}
                className="mt-1"
                disabled={supporter.isBusy}
                label="Show Ferry FYI advertisements"
                onChange={(enabled) => {
                  // toggle supporter advertisements
                  supporter.setAdsEnabled(enabled).catch(() => undefined);
                }}
              />
            </div>
          )}
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

      {/* inactive subscription purchase */}
      {userState.isAuthenticated &&
        supporter.status &&
        !supporter.status.active &&
        !supporter.isLoading && (
          <div className="mt-6 text-left">
            {supporter.products.length === 2 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {/* list current product options */}
                {supporter.products.map((product) => (
                  <button
                    aria-pressed={selectedInterval === product.interval}
                    className={clsx(
                      "relative rounded-2xl border-2 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60",
                      selectedInterval === product.interval
                        ? "border-green-dark bg-green-50 hover:bg-green-lightest dark:border-green-light dark:bg-green-dark/40 dark:hover:bg-green-dark"
                        : "border-gray-200 bg-white hover:border-green-dark hover:bg-green-lightest dark:border-gray-dark dark:bg-white/5 dark:hover:border-green-light dark:hover:bg-green-dark"
                    )}
                    disabled={supporter.isBusy}
                    key={product.interval}
                    onClick={() => {
                      // select checkout interval
                      setSelectedInterval(product.interval);
                    }}
                    type="button"
                  >
                    {product.interval === "year" && (
                      <span className="absolute right-3 top-3 rounded-full bg-green-dark px-2.5 py-1 text-2xs font-black uppercase tracking-wide text-white dark:bg-green-light dark:text-green-dark">
                        33% OFF
                      </span>
                    )}
                    <span
                      className={clsx(
                        "block text-lg font-black",
                        product.interval === "year" && "pr-20"
                      )}
                    >
                      {product.interval === "month" ? "Monthly" : "Yearly"}
                    </span>
                    <span className="mt-2 block text-2xl font-black">
                      {product.price}
                      <span className="text-sm font-semibold">
                        /{product.interval === "month" ? "month" : "year"}
                      </span>
                    </span>
                  </button>
                ))}
                <button
                  className="button button-primary h-14 sm:col-span-2"
                  disabled={supporter.isBusy}
                  onClick={() => {
                    // start selected checkout
                    purchase(selectedInterval).catch(() => undefined);
                  }}
                  type="button"
                >
                  Continue
                </button>
              </div>
            )}
            {supporter.products.length !== 2 && !supporter.error && (
              <p className="rounded-2xl bg-gray-lightest p-4 text-sm dark:bg-white/10">
                Subscription checkout is not available on this app version or
                platform yet.
              </p>
            )}
            {platform !== "web" && (
              <button
                className="button button-outline mt-4"
                disabled={supporter.isBusy}
                onClick={restore}
                type="button"
              >
                Restore Purchases
              </button>
            )}
            <p className="mt-5 text-xs leading-relaxed text-gray-dark dark:text-gray-light">
              Ferry FYI Supporter renews automatically{renewalPriceCopy}until
              canceled. {purchaseDisclosure.payment}{" "}
              {purchaseDisclosure.management} Sign in to your Ferry FYI account
              to use Supporter benefits
              {purchaseDisclosure.restore
                ? `; ${purchaseDisclosure.restore}`
                : "."}{" "}
              Access normally continues through the paid period. By subscribing,
              you agree to the{" "}
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

      {/* provider failure feedback */}
      {supporter.error && (
        <div
          aria-live="polite"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-left text-sm font-semibold text-red-900 dark:border-red-dark dark:bg-red-dark/20 dark:text-red-light"
          role="alert"
        >
          <p>{supporter.error}</p>
          <button
            className="button button-secondary mt-3"
            disabled={supporter.isLoading}
            onClick={() => supporter.refresh().catch(() => undefined)}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {/* inline success feedback */}
      {notice && !supporter.error && (
        <div
          aria-live="polite"
          className="mt-5 rounded-2xl border border-green-light bg-green-50 p-4 text-left text-sm font-semibold text-green-dark dark:border-green-dark dark:bg-green-dark/20 dark:text-green-light"
          role="status"
        >
          <p>{notice}</p>
        </div>
      )}
    </section>
  );
};
