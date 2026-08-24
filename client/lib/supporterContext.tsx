import { createContext, useContext } from "react";
import type {
  SupporterProductOption,
  SupporterPurchaseResult,
  SupporterStatus,
} from "shared/contracts/supporter";

export interface SupporterContextValue {
  error: string | null;
  isBusy: boolean;
  isLoading: boolean;
  products: SupporterProductOption[];
  manage: () => Promise<void>;
  purchase: (
    interval: "month" | "year"
  ) => Promise<SupporterPurchaseResult | null>;
  refresh: () => Promise<void>;
  restore: () => Promise<void>;
  status: SupporterStatus | null;
}

const anonymousSupporter: SupporterContextValue = {
  error: null,
  isBusy: false,
  isLoading: false,
  manage: () => Promise.resolve(),
  products: [],
  purchase: () => Promise.resolve(null),
  refresh: () => Promise.resolve(),
  restore: () => Promise.resolve(),
  status: null,
};

export const SupporterContext =
  createContext<SupporterContextValue>(anonymousSupporter);

/** Reads the current account-bound supporter state. */
export const useSupporter = (): SupporterContextValue =>
  useContext(SupporterContext);
