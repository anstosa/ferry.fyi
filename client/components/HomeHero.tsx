import React, { type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

import logo from "~/static/images/icon_monochrome-256.png";

const QUICK_LINK_CLASSES =
  "inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-sm font-bold shadow-sm transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export const HomeHero = ({
  leaderboardsEnabled,
  leaderboardIcon,
  ticketIcon,
}: {
  leaderboardsEnabled: boolean;
  leaderboardIcon?: ReactNode;
  ticketIcon?: ReactNode;
}): ReactElement => (
  <div className="flex h-[calc(16rem+var(--safe-area-inset-top))] w-full flex-col items-center justify-center pt-safe-top">
    <img
      alt="Ferry FYI"
      className="w-28"
      fetchPriority="high"
      height={112}
      src={logo}
      width={112}
    />
    <h1 className="text-4xl font-bold">Ferry FYI</h1>
    <nav aria-label="Quick links" className="mt-3 flex items-center gap-3">
      <Link className={QUICK_LINK_CLASSES} to="/tickets">
        {ticketIcon}
        Tickets
      </Link>
      {leaderboardsEnabled ? (
        <Link className={QUICK_LINK_CLASSES} to="/leaderboards">
          {leaderboardIcon}
          Leaderboards
        </Link>
      ) : null}
    </nav>
  </div>
);
