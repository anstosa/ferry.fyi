import clsx from "clsx";
import React, { type ReactElement } from "react";

import type { SupporterPurchaseState } from "~/components/SupporterCard";
import CheckIcon from "~/static/images/icons/solid/check.svg";

interface Props {
  state: SupporterPurchaseState;
}

/** Presents a successful purchase while access finishes activating. */
export const SupporterPurchaseSplash = ({ state }: Props): ReactElement => {
  const isVerifying = state === "verification_pending";

  return (
    <section
      aria-live="polite"
      className="mt-8 flex flex-col items-center text-center"
      role="status"
    >
      <div className="relative flex h-28 w-28 items-center justify-center">
        {/* animate pending verification */}
        {isVerifying && (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-1 animate-ping rounded-full bg-green-light/30"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-pulse rounded-full border-4 border-green-light/50"
            />
          </>
        )}
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-green-dark shadow-lg dark:bg-green-light">
          <CheckIcon
            aria-hidden
            className="h-9 w-9 fill-white dark:fill-green-dark"
          />
        </span>
      </div>

      <p className="mt-5 text-xs font-black uppercase tracking-[0.16em] text-green-dark dark:text-green-light">
        Payment confirmed
      </p>
      <h2 className="mt-2 text-xl font-black">
        {isVerifying ? "Activating your benefits" : "You’re all set"}
      </h2>
      <p className="mt-3 max-w-md text-sm font-semibold leading-relaxed text-gray-dark dark:text-gray-light">
        {isVerifying
          ? "This normally takes only a few seconds. Your Supporter access will appear automatically after verification."
          : "Your ad-free Ferry FYI experience is active. Thank you for supporting the app."}
      </p>

      <div
        className={clsx(
          "mt-6 inline-flex items-center gap-3 rounded-full px-5 py-3 text-sm font-bold",
          isVerifying
            ? "bg-green-50 text-green-dark dark:bg-green-dark/30 dark:text-green-light"
            : "bg-green-lightest text-green-dark dark:bg-green-dark dark:text-green-lightest"
        )}
      >
        {/* show one active loader */}
        {isVerifying && (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-green-light border-t-green-dark dark:border-green-dark dark:border-t-green-light"
          />
        )}
        {isVerifying ? "Verifying Supporter access…" : "Supporter active"}
      </div>
    </section>
  );
};
