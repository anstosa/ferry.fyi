import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import React, {
  type FunctionComponent,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  SupporterProductOption,
  SupporterPurchaseResult,
  SupporterReconcileResult,
  SupporterStatus,
} from "shared/contracts/supporter";

import { ApiError, get, post, put } from "~/lib/api";
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
  openWebSupporterManagement,
  purchaseWebSupporter,
} from "~/lib/supporterWeb";
import { useUser } from "~/lib/user";
import type { UserActions } from "~/lib/userContext";

// fail account requests quickly while allowing slower storefront metadata
const SUPPORTER_ACCOUNT_LOAD_TIMEOUT_MS = 12_000;
const SUPPORTER_PRODUCT_LOAD_TIMEOUT_MS = 45_000;
const SUPPORTER_LOAD_TIMEOUT_MESSAGE =
  "Supporter plans took too long to load. Try again.";

// identify one rejected application token
const isUnauthorizedRequest = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

// retry one authenticated supporter request
const requestSupporterApi = async <T,>(
  getAccessToken: UserActions["getAccessToken"],
  request: (accessToken: string) => Promise<T>,
  missingTokenMessage: string,
  initialAccessToken?: string
): Promise<{ accessToken: string; value: T }> => {
  const accessToken = initialAccessToken ?? (await getAccessToken());
  // initial token guard
  if (!accessToken) {
    throw new Error(missingTokenMessage);
  }
  try {
    return { accessToken, value: await request(accessToken) };
  } catch (error) {
    // non-authentication failure guard
    if (!isUnauthorizedRequest(error)) {
      throw error;
    }
    const refreshedAccessToken = await getAccessToken({ bypassCache: true });
    // refreshed token guard
    if (!refreshedAccessToken) {
      throw error;
    }
    return {
      accessToken: refreshedAccessToken,
      value: await request(refreshedAccessToken),
    };
  }
};

// bound one external loading step
const withSupporterLoadTimeout = async <T,>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(SUPPORTER_LOAD_TIMEOUT_MESSAGE));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    // clear the bounded timer
    if (timer) {
      clearTimeout(timer);
    }
  }
};

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
      const { accessToken, value: nextStatus } = await withSupporterLoadTimeout(
        requestSupporterApi(
          userActionsRef.current.getAccessToken,
          async (token) => await get<SupporterStatus>("/supporter", token),
          "Sign in again to load your Supporter subscription."
        ),
        SUPPORTER_ACCOUNT_LOAD_TIMEOUT_MS
      );
      // account ownership guard
      if (requestGeneration !== generation.current) {
        return;
      }
      setStatus(nextStatus);
      setProducts([]);
      // synchronize ad and upgrade policy
      if (userState.user?.supporter?.revision !== nextStatus.revision) {
        await userActionsRef.current.refreshUser(accessToken);
      }
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
        ? await withSupporterLoadTimeout(
            loadNativeSupporterProducts(nextStatus.appUserId),
            SUPPORTER_PRODUCT_LOAD_TIMEOUT_MS
          )
        : await withSupporterLoadTimeout(
            loadWebSupporterProducts(nextStatus.appUserId),
            SUPPORTER_PRODUCT_LOAD_TIMEOUT_MS
          );
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
  }, [userState.isAuthenticated, userState.user?.supporter?.revision]);

  // reset on auth ownership changes
  useLayoutEffect(() => {
    generation.current += 1;
    setStatus(null);
    setProducts([]);
    setError(null);
    setLoading(false);
    setBusy(false);
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
  const reconcile = async (
    initialAccessToken?: string
  ): Promise<SupporterStatus> => {
    const { accessToken, value: result } = await requestSupporterApi(
      userActionsRef.current.getAccessToken,
      async (token) =>
        await post<SupporterReconcileResult>("/supporter/reconcile", {}, token),
      "Sign in again to verify your Supporter subscription.",
      initialAccessToken
    );
    // status response guard
    if (!result.status) {
      throw new Error("Purchase received; verifying access.");
    }
    setStatus(result.status);
    await userActionsRef.current.refreshUser(accessToken);
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
      const accessToken = await userActionsRef.current.getAccessToken();
      // authenticated checkout guard
      if (!accessToken) {
        throw new Error("Sign in again before subscribing.");
      }
      const outcome = Capacitor.isNativePlatform()
        ? await purchaseNativeSupporter(status.appUserId, interval)
        : await purchaseWebSupporter(status.appUserId, interval);
      // neutral cancellation guard
      if (outcome === "cancelled") {
        return { outcome: "cancelled", status };
      }
      const nextStatus = await reconcile(accessToken);
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
      const accessToken = await userActionsRef.current.getAccessToken();
      // authenticated restore guard
      if (!accessToken) {
        throw new Error("Sign in again before restoring purchases.");
      }
      await restoreNativeSupporter(status.appUserId);
      await reconcile(accessToken);
    } catch (restoreError) {
      setError(getSupporterError(restoreError));
      throw restoreError;
    } finally {
      setBusy(false);
    }
  };

  // update the account-wide supporter ad preference
  const setAdsEnabled = async (enabled: boolean): Promise<void> => {
    // active supporter guard
    if (!status?.active || isBusy) {
      return;
    }
    setBusy(true);
    setError(null);
    // isolate preference failures
    try {
      const { accessToken, value: nextStatus } = await requestSupporterApi(
        userActionsRef.current.getAccessToken,
        async (token) =>
          await put<SupporterStatus>(
            "/supporter/preferences",
            { adsEnabled: enabled },
            token
          ),
        "Sign in again before changing your ad preference."
      );
      setStatus(nextStatus);
      await userActionsRef.current.refreshUser(accessToken);
    } catch (preferenceError) {
      setError(getSupporterError(preferenceError));
      throw preferenceError;
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
      // native management guard
      if (Capacitor.isNativePlatform()) {
        const url = await getNativeSupporterManagementUrl(status.appUserId);
        await Browser.open({ url });
        return;
      }
      await openWebSupporterManagement(status.appUserId);
    } catch (managementError) {
      setError(getSupporterError(managementError));
      throw managementError;
    } finally {
      setBusy(false);
    }
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
        setAdsEnabled,
        status,
      }}
    >
      {children}
    </SupporterContext.Provider>
  );
};
