import clsx from "clsx";
import React, { type ReactElement } from "react";

import CrownIcon from "~/static/images/icons/solid/crown.svg";

interface BadgeProps {
  className?: string;
}

interface PreferenceProps {
  active: boolean;
  disabled: boolean;
  displayName: string;
  onChange: (visible: boolean) => void;
  visible: boolean;
}

interface IdentityProps {
  className?: string;
  label: string;
  supporterBadge: boolean;
}

/** Renders the public leaderboard Supporter badge. */
export const LeaderboardSupporterBadge = ({
  className,
}: BadgeProps): ReactElement => (
  <span
    className={clsx(
      "inline-flex shrink-0 items-center rounded-full bg-green-lightest px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-green-dark dark:bg-green-dark dark:text-green-lightest",
      className
    )}
  >
    Supporter
  </span>
);

/** Vertically aligns one leaderboard name and optional badge. */
export const LeaderboardIdentity = ({
  className,
  label,
  supporterBadge,
}: IdentityProps): ReactElement => (
  <span className={clsx("flex min-w-0 items-center gap-2", className)}>
    <span className="truncate font-medium">{label}</span>
    {supporterBadge && <LeaderboardSupporterBadge />}
  </span>
);

/** Controls Supporter badge consent with a leaderboard preview. */
export const LeaderboardSupporterBadgePreference = ({
  active,
  disabled,
  displayName,
  onChange,
  visible,
}: PreferenceProps): ReactElement | null => {
  // active supporter guard
  if (!active) {
    return null;
  }
  const previewName = displayName.trim() || "Your name";
  return (
    <section
      aria-labelledby="supporter-badge-title"
      className="mt-4 rounded-2xl border border-green-light bg-green-50 p-4 text-gray-darkest shadow-sm dark:border-green-dark dark:bg-green-dark/20 dark:text-white"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-2xs font-black uppercase tracking-[0.14em] text-green-dark dark:text-green-light">
            Ferry FYI Supporter
          </p>
          <h2 className="mt-1 text-lg font-black" id="supporter-badge-title">
            Supporter badge
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-dark dark:text-gray-light">
            Choose whether the badge appears beside your name on public
            leaderboards.
          </p>
        </div>
        <button
          aria-checked={visible}
          aria-label="Show Supporter badge on public leaderboards"
          className={clsx(
            "relative mt-1 h-7 w-12 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-dark dark:focus-visible:outline-green-light",
            visible
              ? "bg-green-dark dark:bg-green-light"
              : "bg-gray-300 dark:bg-white/20"
          )}
          disabled={disabled}
          onClick={() => {
            // toggle public badge consent
            onChange(!visible);
          }}
          role="switch"
          type="button"
        >
          <span
            className={clsx(
              "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition",
              visible ? "left-6" : "left-1"
            )}
          />
        </button>
      </div>
      <p className="mt-4 text-2xs font-black uppercase tracking-[0.14em] text-gray-dark dark:text-gray-light">
        Preview
      </p>
      <div
        aria-label="Supporter badge preview"
        className="mt-2 flex items-center gap-3 overflow-hidden rounded-xl border border-gray-light bg-white px-4 py-3 dark:border-gray-dark dark:bg-blue-dark"
      >
        <strong
          aria-label="Rank 1"
          className="flex w-6 shrink-0 items-center justify-center text-yellow-dark dark:text-yellow-light"
        >
          <CrownIcon aria-hidden className="h-5 w-5" />
        </strong>
        <LeaderboardIdentity
          className="flex-1"
          label={previewName}
          supporterBadge
        />
        <span className="font-bold">12</span>
      </div>
    </section>
  );
};
