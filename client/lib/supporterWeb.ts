import type {
  Package,
  Purchases as PurchasesInstance,
} from "@revenuecat/purchases-js";
import type { SupporterProductOption } from "shared/contracts/supporter";

let purchases: PurchasesInstance | null = null;
let identityTransition: Promise<void> = Promise.resolve();
let packages: Record<"month" | "year", Package> | null = null;

// require the public web sdk key
const getWebApiKey = (): string => {
  const key = process.env.REVENUECAT_WEB_PUBLIC_API_KEY;
  // key configuration guard
  if (!key) {
    throw new Error("Web subscriptions are not configured");
  }
  return key;
};

// bind the web sdk without aliasing identities
const bindWebPurchases = async (
  appUserId: string
): Promise<PurchasesInstance> => {
  const { Purchases } = await import("@revenuecat/purchases-js");
  // recover prior transition before retry
  identityTransition = identityTransition
    .catch(() => undefined)
    .then(async () => {
      // singleton configuration guard
      if (!purchases) {
        purchases = Purchases.configure({
          apiKey: getWebApiKey(),
          appUserId,
        });
        return;
      }
      // account switch guard
      if (purchases.getAppUserId() !== appUserId) {
        await purchases.changeUser(appUserId);
        packages = null;
      }
    });
  await identityTransition;
  // configured instance guard
  if (!purchases) {
    throw new Error("Web subscriptions could not be initialized");
  }
  return purchases;
};

/** Loads the current monthly and annual web offering. */
export const loadWebSupporterProducts = async (
  appUserId: string
): Promise<SupporterProductOption[]> => {
  const instance = await bindWebPurchases(appUserId);
  packages = null;
  const offering = (await instance.getOfferings()).current;
  // exact package guard
  if (!offering?.monthly || !offering.annual) {
    throw new Error("The Supporter offering is incomplete");
  }
  packages = { month: offering.monthly, year: offering.annual };
  return [
    {
      identifier: offering.monthly.webBillingProduct.identifier,
      interval: "month",
      price: offering.monthly.webBillingProduct.price.formattedPrice,
    },
    {
      identifier: offering.annual.webBillingProduct.identifier,
      interval: "year",
      price: offering.annual.webBillingProduct.price.formattedPrice,
    },
  ];
};

/** Purchases one current web offering package. */
export const purchaseWebSupporter = async (
  appUserId: string,
  interval: "month" | "year"
): Promise<"cancelled" | "purchased"> => {
  const instance = await bindWebPurchases(appUserId);
  // loaded offering guard
  if (!packages) {
    await loadWebSupporterProducts(appUserId);
  }
  const selectedPackage = packages?.[interval];
  // package availability guard
  if (!selectedPackage) {
    throw new Error("That Supporter plan is unavailable");
  }
  // isolate neutral cancellation
  try {
    await instance.purchase({ rcPackage: selectedPackage });
    return "purchased";
  } catch (error) {
    const { ErrorCode, PurchasesError } =
      await import("@revenuecat/purchases-js");
    // cancellation guard
    if (
      error instanceof PurchasesError &&
      error.errorCode === ErrorCode.UserCancelledError
    ) {
      return "cancelled";
    }
    throw error;
  }
};
