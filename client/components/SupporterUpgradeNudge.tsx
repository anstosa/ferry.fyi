import React, { type ReactElement } from "react";

import CrownIcon from "~/static/images/icons/solid/crown.svg";

interface Props {
  active: boolean;
  heading?: string;
  resolved: boolean;
}

/** Promotes Supporter only after the inactive account state is authoritative. */
export const SupporterUpgradeNudge = ({
  active,
  heading = "Go ad-free with Ferry FYI Supporter",
  resolved,
}: Props): ReactElement | null => {
  // hide unresolved and upgraded accounts
  if (!resolved || active) {
    return null;
  }
  return (
    <aside
      aria-labelledby="supporter-upgrade-title"
      className="mt-4 rounded-2xl border border-yellow-medium bg-yellow-lightest p-4 text-gray-darkest shadow-sm dark:border-yellow-dark dark:bg-blue-dark dark:text-white"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-yellow-medium/25 text-yellow-dark dark:text-yellow-light">
          <CrownIcon aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-black uppercase tracking-[0.14em] text-yellow-dark dark:text-yellow-light">
            Ferry FYI Supporter
          </p>
          <h2 className="mt-1 text-lg font-black" id="supporter-upgrade-title">
            {heading}
          </h2>
          <p className="mt-1 text-sm leading-relaxed">
            Go ad-free throughout Ferry FYI and optionally add a Supporter badge
            to your public leaderboard profile.
          </p>
          <a className="button button-primary mt-3" href="/supporter">
            Go ad-free
          </a>
        </div>
      </div>
    </aside>
  );
};
