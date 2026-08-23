import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import React, {
  type FunctionComponent,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LeaderboardPreferences } from "shared/contracts/leaderboards";
import type {
  SupporterManagementResult,
  SupporterProductOption,
  SupporterPurchaseResult,
  SupporterReconcileResult,
  SupporterStatus,
} from "shared/contracts/supporter";

import { get, post, put } from "~/lib/api";
import { SupporterContext } from "~/lib/supporterContext";
import {
  getNativeSupporterManagementUrl,
  hasNativeSupporterCapability,
  loadNativeSupporterProducts,
  purchaseNativeSupporter,
  restoreNativeSupporter,
} from "~/lib/supporterNative";
import {
  loadWebSupporterProducts,
  purchaseWebSupporter,
} from "~/lib/supporterWeb";
import { useUser } from "~/lib/user";

// normalize one unknown error
const getSupporterError = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Supporter subscriptions are temporarily unavailable.";

// check one platform checkout switch
const isCheckoutAvailable = (status: SupporterStatus): boolean => {
  const platform = Capacitor.getPlatform();
  // ios switch guard
  if (platform === "ios") {
    return status.checkoutAvailability.ios;
  }
  // android switch guard
  if (platform === "android") {
    return status.checkoutAvailability.android;
  }
  return status.checkoutAvailability.web;
};

/** Owns identity-safe RevenueCat binding and server reconciliation. */
export const SupporterProvider: FunctionComponent<PropsWithChildren> = ({
  children,
}) => {
  const [userState, userActions] = useUser();
  const userActionsRef = useRef(userActions);
  userActionsRef.current = userActions;
  const [status, setStatus] = useState<SupporterStatus | null>(null);
  const [products, setProducts] = useState<SupporterProductOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const generation = useRef(0);

  // load current account status
  const refresh = useCallback(async (): Promise<void> => {
    const requestGeneration = generation.current;
    // authenticated account guard
    if (!userState.isAuthenticated) {
      setStatus(null);
      setProducts([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    // isolate account status failures
    try {
      const token = await userActionsRef.current.getAccessToken();
      // token readiness guard
      if (!token || requestGeneration !== generation.current) {
        return;
      }
      const nextStatus = await get<SupporterStatus>("/supporter", token);
      // stale account guard
      if (requestGeneration !== generation.current) {
        return;
      }
      setStatus(nextStatus);
      setProducts([]);
      // active account guard
      if (nextStatus.active || !isCheckoutAvailable(nextStatus)) {
        return;
      }
      const native = Capacitor.isNativePlatform();
      // old shell guard
      if (native && !hasNativeSupporterCapability()) {
        setError("Update Ferry FYI to subscribe or restore purchases.");
        return;
      }
      const nextProducts = native
        ? await loadNativeSupporterProducts(nextStatus.appUserId)
        : await loadWebSupporterProducts(nextStatus.appUserId);
      // stale offering guard
      if (requestGeneration === generation.current) {
        setProducts(nextProducts);
      }
    } catch (loadError) {
      // stale failure guard
      if (requestGeneration === generation.current) {
        setError(getSupporterError(loadError));
      }
    } finally {
      // stale loading guard
      if (requestGeneration === generation.current) {
        setLoading(false);
      }
    }
  }, [userState.isAuthenticated]);

  // reset on auth ownership changes
  useEffect(() => {
    generation.current += 1;
    setStatus(null);
    setProducts([]);
    setError(null);
  }, [userState.user?.user_id]);

  // refresh on foreground return
  useEffect(() => {
    const onVisibilityChange = (): void => {
      // initialized visibility guard
      if (document.visibilityState === "visible" && status) {
        refresh().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, status]);

  // reconcile the provider result with server authority
  const reconcile = async (token: string): Promise<SupporterStatus> => {
    const result = await post<SupporterReconcileResult>(
      "/supporter/reconcile",
      {},
      token
    );
    // status response guard
    if (!result.status) {
      throw new Error("Purchase received; verifying access.");
    }
    setStatus(result.status);
    await userActionsRef.current.refreshUser(token);
    return result.status;
  };

  // purchase one selected interval
  const purchase = async (
    interval: "month" | "year"
  ): Promise<SupporterPurchaseResult | null> => {
    // purchase readiness guard
    if (!status || status.active || isBusy) {
      return null;
    }
    setBusy(true);
    setError(null);
    // isolate purchase failures
    try {
      const token = await userActionsRef.current.getAccessToken();
      // token readiness guard
      if (!token) {
        throw new Error("Sign in again before subscribing.");
      }
      const outcome = Capacitor.isNativePlatform()
        ? await purchaseNativeSupporter(status.appUserId, interval)
        : await purchaseWebSupporter(status.appUserId, interval);
      // neutral cancellation guard
      if (outcome === "cancelled") {
        return { outcome: "cancelled", status };
      }
      const nextStatus = await reconcile(token);
      return {
        outcome: nextStatus.active ? "purchased" : "verification_pending",
        status: nextStatus,
      };
    } catch (purchaseError) {
      setError(getSupporterError(purchaseError));
      throw purchaseError;
    } finally {
      setBusy(false);
    }
  };

  // restore native store purchases
  const restore = async (): Promise<void> => {
    // native restore guard
    if (!status || !Capacitor.isNativePlatform() || isBusy) {
      return;
    }
    setBusy(true);
    setError(null);
    // isolate restore failures
    try {
      const token = await userActionsRef.current.getAccessToken();
      // token readiness guard
      if (!token) {
        throw new Error("Sign in again before restoring purchases.");
      }
      await restoreNativeSupporter(status.appUserId);
      await reconcile(token);
    } catch (restoreError) {
      setError(getSupporterError(restoreError));
      throw restoreError;
    } finally {
      setBusy(false);
    }
  };

  // open source-appropriate subscription management
  const manage = async (): Promise<void> => {
    // management readiness guard
    if (!status || isBusy) {
      return;
    }
    setBusy(true);
    setError(null);
    // isolate management failures
    try {
      let url: string;
      // native management guard
      if (Capacitor.isNativePlatform()) {
        url = await getNativeSupporterManagementUrl(status.appUserId);
        await Browser.open({ url });
        return;
      }
      const token = await userActionsRef.current.getAccessToken();
      // token readiness guard
      if (!token) {
        throw new Error("Sign in again to manage your subscription.");
      }
      const result = await post<SupporterManagementResult>(
        "/supporter/management",
        {},
        token
      );
      window.location.assign(result.url);
    } catch (managementError) {
      setError(getSupporterError(managementError));
      throw managementError;
    } finally {
      setBusy(false);
    }
  };

  // save public badge consent
  const setBadgeVisible = async (visible: boolean): Promise<void> => {
    const token = await userActionsRef.current.getAccessToken();
    // token readiness guard
    if (!token || !status) {
      throw new Error("Sign in again to change Supporter badge visibility.");
    }
    await put<LeaderboardPreferences>(
      "/leaderboards/preferences",
      { supporterBadgeVisible: visible },
      token
    );
    setStatus({ ...status, supporterBadgeVisible: visible });
  };

  return (
    <SupporterContext.Provider
      value={{
        error,
        isBusy,
        isLoading,
        manage,
        products,
        purchase,
        refresh,
        restore,
        setBadgeVisible,
        status,
      }}
    >
      {children}
    </SupporterContext.Provider>
  );
};
