import { DateTime } from "luxon";
import React, { type ReactElement, type ReactNode } from "react";
import type { PublicSsrTerminal } from "shared/contracts/ssr";
import type { Address, TerminalInfo } from "shared/contracts/terminals";
import { getStaticPublicSsrTerminalSlug } from "shared/lib/ssrRouteMatch";

import { RoutePageIntro } from "~/components/RoutePageIntro";
import { RouteQuickLinks } from "~/components/RouteQuickLinks";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import AlertsIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-week.svg";
import CamerasIcon from "~/static/images/icons/solid/cctv.svg";
import DirectionsIcon from "~/static/images/icons/solid/directions.svg";
import FaresIcon from "~/static/images/icons/solid/dollar-sign.svg";
import NavigationIcon from "~/static/images/icons/solid/location-arrow.svg";
import MapIcon from "~/static/images/icons/solid/map.svg";

export type OverviewTerminal = Pick<
  PublicSsrTerminal,
  "abbreviation" | "id" | "name"
> &
  Partial<
    Pick<
      PublicSsrTerminal,
      | "hasElevator"
      | "hasFood"
      | "hasOverheadLoading"
      | "hasRestroom"
      | "hasWaitingRoom"
      | "info"
      | "waitTimes"
    >
  > & {
    terminalUrl?: string | null;
    location?: {
      address?: Address | PublicSsrTerminal["location"]["address"];
      latitude: number;
      link?: string | null;
      longitude: number;
    };
    mates?: PublicSsrTerminal["mates"];
  };

// reserve source prose without hiding the section heading or fixed guidance
const LoadingProse = ({
  label,
  className = "mt-3",
}: {
  label: string;
  className?: string;
}): ReactElement => (
  <SkeletonGroup className={`${className} space-y-2`} label={label}>
    <Skeleton className="h-4 w-full" variant="text" />
    <Skeleton className="h-4 w-3/4" variant="text" />
  </SkeletonGroup>
);

const DIRECTIONS_LINK_CLASS =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-green-dark/25 text-green-dark transition hover:bg-green-dark/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-green-light/30 dark:text-[#b5ead9] dark:hover:bg-white/5";
const COPY_CLASS =
  "mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300";

const SECONDARY_SECTIONS: { key: keyof TerminalInfo; label: string }[] = [
  { key: "bicycle", label: "Bicycle boarding" },
  { key: "motorcycle", label: "Motorcycle boarding" },
  { key: "truck", label: "Trucks and large vehicles" },
  { key: "construction", label: "Construction" },
  { key: "security", label: "Security" },
  { key: "lost", label: "Lost and found" },
];

// retain semantic sections without top-level card shells
const InfoSection = ({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id: string;
  title: string;
}): ReactElement => (
  <section
    aria-labelledby={`${id}-heading`}
    className="min-w-0 scroll-mt-4"
    id={id}
  >
    <h2 className="text-lg font-bold" id={`${id}-heading`}>
      {title}
    </h2>
    {children}
  </section>
);

// preserve the provider's guidance timestamp without inventing freshness
const GuidanceTime = ({ value }: { value: number }): ReactElement => {
  // missing or malformed source epochs stay unknown
  if (!Number.isFinite(value) || value <= 0) {
    return <span>Source update time unavailable</span>;
  }
  const time = DateTime.fromSeconds(value, { zone: "America/Los_Angeles" });
  // reject out-of-range source dates
  if (!time.isValid) {
    return <span>Source update time unavailable</span>;
  }
  return (
    <>
      WSF guidance updated{" "}
      <time dateTime={time.toISO() ?? undefined}>
        {time.toFormat("MMM d, yyyy · h:mm a ZZZZ")}
      </time>
    </>
  );
};

// accept valid provider map links but fall back from malformed html fragments
const getMapUrl = (
  location: NonNullable<OverviewTerminal["location"]>
): string => {
  const fallback = `https://www.google.com/maps/search/${location.latitude},${location.longitude}`;
  // WSF map fields sometimes include a closing paragraph tag
  if (!location.link || /[<>]|%3[ce]/i.test(location.link)) {
    return fallback;
  }
  // preserve http map destinations only
  try {
    const link = new URL(location.link);
    return ["https:", "http:"].includes(link.protocol) ? link.href : fallback;
  } catch {
    return fallback;
  }
};

// render plain source text only; the browser boundary converts provider html
export const TerminalOverview = ({
  afterNavigation,
  loading = false,
  mate,
  terminal,
}: {
  afterNavigation?: ReactNode;
  loading?: boolean;
  mate?: Pick<PublicSsrTerminal, "id" | "name"> | null;
  terminal: OverviewTerminal;
}): ReactElement => {
  const address = terminal.location?.address;
  const info = terminal.info ?? {};
  const locality = [
    address?.city,
    [address?.state, address?.zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const addressLines = [address?.line1, address?.line2, locality].filter(
    Boolean
  );
  // preserve the selected direction or use the terminal's first listed destination
  const destination = mate ?? terminal.mates?.[0];
  const terminalSlug = getStaticPublicSsrTerminalSlug(terminal.id);
  const mateSlug = destination
    ? getStaticPublicSsrTerminalSlug(destination.id)
    : undefined;
  // unknown identities have no fabricated route links
  const routePath =
    terminalSlug && mateSlug
      ? `/${terminalSlug}${terminal.mates?.length === 1 ? "" : `/${mateSlug}`}`
      : null;
  // match the bottom bar while omitting the current terminal destination
  const links = routePath
    ? [
        { Icon: ScheduleIcon, label: "Schedule & wait", path: routePath },
        {
          Icon: NavigationIcon,
          label: "What boat will I make?",
          path: `${routePath}/navigation`,
        },
        {
          Icon: CamerasIcon,
          label: "Ferry line cameras",
          path: `${routePath}/cameras`,
        },
        { Icon: MapIcon, label: "Route Map", path: `${routePath}/map` },
        {
          Icon: FaresIcon,
          label: "How much does it cost?",
          path: `${routePath}/fare`,
        },
        {
          Icon: AlertsIcon,
          label: "WSF Alerts",
          path: `${routePath}/alerts`,
        },
      ]
    : [];
  const guidance = (terminal.waitTimes ?? []).filter(({ description }) =>
    description.trim()
  );
  // enumerate source-listed facilities without inferring accessible boarding
  const facilities = [
    { label: "Restrooms", available: terminal.hasRestroom },
    { label: "Waiting room", available: terminal.hasWaitingRoom },
    { label: "Food service", available: terminal.hasFood },
    { label: "Elevator", available: terminal.hasElevator },
    {
      label: "Overhead passenger loading",
      available: terminal.hasOverheadLoading,
    },
  ];
  const secondarySections = SECONDARY_SECTIONS.filter(({ key }) =>
    info[key]?.trim()
  );
  // keep facility names static and announce only pending source-owned availability
  const facilityList = (
    <ul className="space-y-2 text-sm">
      {/* render the same rows before and after current facts arrive */}
      {facilities.map(({ label, available }) => (
        <li
          key={label}
          className="flex flex-wrap justify-between gap-x-3 rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/5"
        >
          <span>{label}: </span>
          {loading ? (
            <Skeleton className="h-5 w-20" variant="text" />
          ) : (
            <span
              className={
                available
                  ? "font-semibold text-green-dark dark:text-[#b5ead9]"
                  : "text-gray-600 dark:text-gray-300"
              }
            >
              {available ? "available" : "unavailable"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4 text-gray-900 dark:text-gray-100">
      <section>
        <RoutePageIntro
          title={`${terminal.name} Ferry Terminal`}
          description="Find parking, directions, arrival guidance and terminal facilities."
        />
        {/* keep directions beside the readable address with an accessible icon-only action */}
        <div className="mt-3 flex w-fit max-w-full items-center gap-3">
          {addressLines.length ? (
            <address className="min-w-0 break-words text-sm not-italic leading-relaxed">
              {addressLines.map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </address>
          ) : null}
          {!addressLines.length && loading ? (
            <LoadingProse
              className="w-56 max-w-full"
              label="Loading terminal address"
            />
          ) : null}
          {!addressLines.length && !loading ? (
            <p className="min-w-0 text-sm text-gray-700 dark:text-gray-300">
              Address unavailable.
            </p>
          ) : null}
          {terminal.location ? (
            <a
              aria-label="Get directions"
              className={DIRECTIONS_LINK_CLASS}
              href={getMapUrl(terminal.location)}
              rel="noopener noreferrer"
              target="_blank"
              title="Get directions"
            >
              <DirectionsIcon aria-hidden="true" className="h-5 w-5" />
            </a>
          ) : (
            <button
              aria-label="Get directions"
              className={DIRECTIONS_LINK_CLASS}
              disabled
              type="button"
            >
              <DirectionsIcon aria-hidden="true" className="h-5 w-5" />
            </button>
          )}
        </div>
      </section>

      {/* keep local section jumps above cross-page route buttons */}
      <nav
        aria-label="Terminal information"
        className="flex flex-wrap gap-x-3 gap-y-0 text-sm font-semibold text-green-dark dark:text-[#b5ead9]"
      >
        <a
          className="min-h-9 inline-flex items-center underline underline-offset-4"
          href="#terminal-parking"
        >
          Parking &amp; transit
        </a>
        <a
          className="min-h-9 inline-flex items-center underline underline-offset-4"
          href="#terminal-arrival"
        >
          When to arrive
        </a>
        <a
          className="min-h-9 inline-flex items-center underline underline-offset-4"
          href="#terminal-accessibility"
        >
          Accessibility
        </a>
        <a
          className="min-h-9 inline-flex items-center underline underline-offset-4"
          href="#terminal-facilities"
        >
          Facilities
        </a>
      </nav>

      {/* reuse schedule buttons with the current page replaced by schedule and wait */}
      {links.length > 0 && (
        <RouteQuickLinks ariaLabel="Terminal planning links" links={links} />
      )}
      {afterNavigation}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <InfoSection id="terminal-parking" title="Parking & getting here">
          {loading ? (
            <LoadingProse label="Loading parking and transit details" />
          ) : (
            <p className={COPY_CLASS}>
              {info.parking?.trim() ||
                "Parking details are not available from WSF. Check the official terminal page before you travel."}
            </p>
          )}
          {/* transport guidance remains visible rather than click-only */}
          {info.airport?.trim() && (
            <>
              <h3 className="mt-5 text-sm font-bold">
                Airport & shuttle connections
              </h3>
              <p className={COPY_CLASS}>{info.airport}</p>
            </>
          )}
          {info.train?.trim() && (
            <>
              <h3 className="mt-5 text-sm font-bold">Train connections</h3>
              <p className={COPY_CLASS}>{info.train}</p>
            </>
          )}
          <p className="mt-4 text-xs text-gray-600 dark:text-gray-300">
            WSF terminal guidance. Parking rates, restrictions and transport
            services can change; confirm with the operator.
          </p>
        </InfoSection>
        <InfoSection id="terminal-arrival" title="When should I arrive?">
          <p className={COPY_CLASS}>
            WSF arrival guidance is general advice, not a measured live queue
            wait or a boarding guarantee. Check your route’s schedule, wait
            reports and cameras before leaving.
          </p>
          {/* retain individual source notes and their original dates */}
          {loading ? (
            <LoadingProse label="Loading WSF arrival guidance" />
          ) : null}
          {!loading && guidance.length > 0 ? (
            <ul className="mt-4 space-y-4">
              {guidance.map((wait, index) => (
                <li
                  key={index}
                  className="rounded-xl border border-green-dark/15 bg-green-dark/5 p-4 dark:border-green-light/20 dark:bg-white/5"
                >
                  {wait.title && (
                    <h3 className="text-sm font-bold">{wait.title}</h3>
                  )}
                  <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed">
                    {wait.description}
                  </p>
                  <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
                    <GuidanceTime value={wait.time} />
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {!loading && !guidance.length ? (
            <p className={COPY_CLASS}>
              Arrival guidance is not available from WSF for this terminal.
            </p>
          ) : null}
        </InfoSection>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <InfoSection
          id="terminal-accessibility"
          title="Accessibility & boarding assistance"
        >
          {loading ? (
            <LoadingProse label="Loading accessibility details" />
          ) : (
            <p className={COPY_CLASS}>
              {info.ada?.trim() ||
                "Accessibility details are not available from WSF. Confirm boarding assistance and access needs with WSF before traveling."}
            </p>
          )}
          <p className="mt-4 text-xs text-gray-600 dark:text-gray-300">
            An elevator listing alone does not establish step-free access. Check
            WSF guidance for your terminal and sailing.
          </p>
        </InfoSection>
        <InfoSection id="terminal-facilities" title="Facilities & food">
          {loading ? (
            <SkeletonGroup label="Loading terminal facilities" className="mt-3">
              {facilityList}
            </SkeletonGroup>
          ) : (
            <div className="mt-3">{facilityList}</div>
          )}
          {/* generic food service does not imply vending machines */}
          {info.food?.trim() && (
            <details className="mt-4 rounded-lg border border-black/10 p-3 dark:border-white/10">
              <summary className="cursor-pointer text-sm font-semibold">
                WSF food service &amp; vessel galley details
              </summary>
              <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
                Food guidance may include vessel galley hours. Confirm the
                route, season and current hours with WSF.
              </p>
              <p className={COPY_CLASS}>{info.food}</p>
            </details>
          )}
          <p className="mt-4 text-xs text-gray-600 dark:text-gray-300">
            Facilities listed by WSF; availability can change.
          </p>
        </InfoSection>
      </div>

      {/* native disclosures retain less common answers in initial html */}
      {secondarySections.length > 0 && (
        <section aria-label="More terminal information">
          {secondarySections.map(({ key, label }) => (
            <details
              key={key}
              className="border-b border-black/10 py-4 last:border-0 dark:border-white/10"
            >
              <summary className="cursor-pointer text-sm font-bold">
                {label}
              </summary>
              <p className={COPY_CLASS}>{info[key]}</p>
            </details>
          ))}
        </section>
      )}
    </div>
  );
};
