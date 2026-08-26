import { Capacitor } from "@capacitor/core";
import type {
  PurchasesPackage,
  PurchasesPlugin,
} from "@revenuecat/purchases-capacitor";
import type { SupporterProductOption } from "shared/contracts/supporter";

import { createNonThenableCapacitorPlugin } from "~/lib/capacitorPlugin";

let purchases: PurchasesPlugin | null = null;
let identityTransition: Promise<void> = Promise.resolve();
let packages: Record<"month" | "year", PurchasesPackage> | null = null;

// resolve the platform public sdk key
const getNativeApiKey = (): string => {
  const platform = Capacitor.getPlatform();
  const key =
    platform === "ios"
      ? process.env.REVENUECAT_IOS_PUBLIC_API_KEY
      : process.env.REVENUECAT_ANDROID_PUBLIC_API_KEY;
  // key configuration guard
  if (!key) {
    throw new Error("Native subscriptions are not configured");
  }
  return key;
};

/** Reports whether the signed native shell contains RevenueCat. */
export const hasNativeSupporterCapability = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Purchases");

// bind the native sdk directly to the server uuid
const bindNativePurchases = async (
  appUserId: string
): Promise<PurchasesPlugin> => {
  // native capability guard
  if (!hasNativeSupporterCapability()) {
    throw new Error("Update Ferry FYI to subscribe or restore purchases");
  }
  const { ENTITLEMENT_VERIFICATION_MODE, Purchases } =
    await import("@revenuecat/purchases-capacitor");
  // recover prior transition before retry
  identityTransition = identityTransition
    .catch(() => undefined)
    .then(async () => {
      // singleton configuration guard
      if (!purchases) {
        purchases = createNonThenableCapacitorPlugin(Purchases);
        await purchases.configure({
          apiKey: getNativeApiKey(),
          appUserID: appUserId,
          automaticDeviceIdentifierCollectionEnabled: false,
          entitlementVerificationMode:
            ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL,
        });
        return;
      }
      const current = await purchases.getAppUserID();
      // account switch guard
      if (current.appUserID !== appUserId) {
        await purchases.logIn({ appUserID: appUserId });
        packages = null;
      }
    });
  await identityTransition;
  // configured instance guard
  if (!purchases) {
    throw new Error("Native subscriptions could not be initialized");
  }
  return purchases;
};

/** Loads the current monthly and annual native offering. */
export const loadNativeSupporterProducts = async (
  appUserId: string
): Promise<SupporterProductOption[]> => {
  const instance = await bindNativePurchases(appUserId);
  packages = null;
  const offering = (await instance.getOfferings()).current;
  // exact package guard
  if (!offering?.monthly || !offering.annual) {
    throw new Error("The Supporter offering is incomplete");
  }
  packages = { month: offering.monthly, year: offering.annual };
  return [
    {
      identifier: offering.monthly.product.identifier,
      interval: "month",
      price: offering.monthly.product.priceString,
    },
    {
      identifier: offering.annual.product.identifier,
      interval: "year",
      price: offering.annual.product.priceString,
    },
  ];
};

// reject failed trusted entitlement verification
const assertTrustedEntitlements = (verification: string): void => {
  // failed verification guard
  if (verification === "FAILED") {
    throw new Error("Purchase verification failed on this device");
  }
};

/** Purchases one current native offering package. */
export const purchaseNativeSupporter = async (
  appUserId: string,
  interval: "month" | "year"
): Promise<"cancelled" | "purchased"> => {
  const instance = await bindNativePurchases(appUserId);
  // loaded offering guard
  if (!packages) {
    await loadNativeSupporterProducts(appUserId);
  }
  const selectedPackage = packages?.[interval];
  // package availability guard
  if (!selectedPackage) {
    throw new Error("That Supporter plan is unavailable");
  }
  // isolate neutral cancellation
  try {
    const result = await instance.purchasePackage({
      aPackage: selectedPackage,
    });
    assertTrustedEntitlements(result.customerInfo.entitlements.verification);
    return "purchased";
  } catch (error) {
    // cancellation guard
    if (
      error &&
      typeof error === "object" &&
      "userCancelled" in error &&
      error.userCancelled === true
    ) {
      return "cancelled";
    }
    throw error;
  }
};

/** Restores native purchases for the already-bound account. */
export const restoreNativeSupporter = async (
  appUserId: string
): Promise<void> => {
  const instance = await bindNativePurchases(appUserId);
  const result = await instance.restorePurchases();
  assertTrustedEntitlements(result.customerInfo.entitlements.verification);
};

/** Resolves the current native store management URL. */
export const getNativeSupporterManagementUrl = async (
  appUserId: string
): Promise<string> => {
  const instance = await bindNativePurchases(appUserId);
  const result = await instance.getCustomerInfo();
  const url = result.customerInfo.managementURL;
  // management destination guard
  if (!url) {
    throw new Error("Subscription management is unavailable");
  }
  return url;
};
