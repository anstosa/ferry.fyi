import React, {
  type AnchorHTMLAttributes,
  forwardRef,
  type ReactElement,
} from "react";
import type { AdCampaignCreative } from "shared/contracts/ads";

interface Props extends AnchorHTMLAttributes<HTMLAnchorElement> {
  adminConfigurable?: boolean;
  creative: AdCampaignCreative;
}

/** Shared cache-safe ad markup used by both SSR and the measured browser slot. */
export const AdCreativeCard = forwardRef<HTMLAnchorElement, Props>(
  (
    { adminConfigurable = false, creative, ...anchorProps },
    ref
  ): ReactElement => {
    return (
      <aside aria-label={`Advertisement from ${creative.advertiserName}`}>
        <a
          aria-label={`${creative.advertiserName}: ${creative.headline}`}
          className="block w-full rounded-xl border border-sponsor-light bg-sponsor-lightest p-3 text-left text-gray-darkest shadow-sm transition hover:border-sponsor-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sponsor-dark dark:border-sponsor-dark dark:bg-sponsor-darkest dark:text-white dark:hover:border-sponsor-light dark:focus-visible:outline-sponsor-light"
          data-ad-campaign={creative.campaignId}
          data-ad-click-target="true"
          data-admin-long-press={adminConfigurable ? "true" : undefined}
          data-ad-placement={creative.placementKey}
          href={creative.targetUrl}
          ref={ref}
          rel="noopener noreferrer"
          target="_blank"
          title={
            adminConfigurable ? "Long press to configure this ad" : undefined
          }
          {...anchorProps}
        >
          <span className="block text-2xs font-bold uppercase tracking-[0.14em] text-sponsor-dark dark:text-sponsor-light">
            {creative.advertiserName}
          </span>
          <span className="mt-0.5 block text-base font-black leading-tight">
            {creative.headline}
          </span>
          {creative.body ? (
            <span className="mt-0.5 block text-xs leading-snug">
              {creative.body}
            </span>
          ) : null}
        </a>
        <p className="mt-1 text-right text-2xs font-semibold text-sponsor-dark dark:text-sponsor-light">
          Advertisement
        </p>
      </aside>
    );
  }
);
