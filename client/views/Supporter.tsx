import React, { type ReactElement, useEffect, useState } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { AuthPageShell } from "~/components/AuthPageShell";
import { SeoHelmet } from "~/components/SeoHelmet";
import {
  SupporterCard,
  type SupporterPurchaseState,
} from "~/components/SupporterCard";
import { SupporterPurchaseSplash } from "~/components/SupporterPurchaseSplash";
import { useSupporter } from "~/lib/supporterContext";

const SUPPORTER_VERIFICATION_POLL_MS = 3_000;

// select purchase-aware page copy
const getSupporterPageCopy = (
  purchaseState: SupporterPurchaseState | null
): { description: string; title: string } => {
  // pending verification copy
  if (purchaseState === "verification_pending") {
    return {
      description: "Ferry FYI is verifying your access.",
      title: "Purchase received",
    };
  }
  // activated purchase copy
  if (purchaseState === "purchased") {
    return {
      description: "Thank you for supporting Ferry FYI.",
      title: "Purchase received",
    };
  }
  return {
    description:
      "Enjoy Ferry FYI without advertisements and help keep reliable ferry tools available to every rider.",
    title: "Support an independent ferry app",
  };
};

/** Public Supporter explanation and account-bound checkout page. */
export const Supporter = (): ReactElement => {
  const supporter = useSupporter();
  const [purchaseState, setPurchaseState] =
    useState<SupporterPurchaseState | null>(null);
  const pageCopy = getSupporterPageCopy(purchaseState);

  // refresh pending access until the webhook projection arrives
  useEffect(() => {
    // pending purchase guard
    if (purchaseState !== "verification_pending") {
      return;
    }
    const timer = window.setInterval(() => {
      supporter.refresh().catch(() => undefined);
    }, SUPPORTER_VERIFICATION_POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [purchaseState, supporter.refresh]);

  // finish the success splash after access becomes active
  useEffect(() => {
    // verified purchase guard
    if (purchaseState === "verification_pending" && supporter.status?.active) {
      setPurchaseState("purchased");
    }
  }, [purchaseState, supporter.status?.active]);

  return (
    <>
      <SeoHelmet seo={getSeoMetadata("/supporter")} />
      <AuthPageShell
        description={pageCopy.description}
        title={pageCopy.title}
        titleId="supporter-title"
      >
        {/* switch checkout to the purchase splash */}
        {purchaseState ? (
          <SupporterPurchaseSplash state={purchaseState} />
        ) : (
          <SupporterCard embedded onPurchaseStateChange={setPurchaseState} />
        )}
      </AuthPageShell>
    </>
  );
};
