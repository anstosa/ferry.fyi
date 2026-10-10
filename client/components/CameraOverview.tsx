import clsx from "clsx";
import React, { type ReactElement } from "react";
import type { PublicSsrTerminal } from "shared/contracts/ssr";
import { getStaticPublicSsrTerminalSlug } from "shared/lib/ssrRouteMatch";

import { RoutePageIntro } from "~/components/RoutePageIntro";
import { RouteQuickLinks } from "~/components/RouteQuickLinks";
import AlertsIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-week.svg";
import FaresIcon from "~/static/images/icons/solid/dollar-sign.svg";
import TerminalIcon from "~/static/images/icons/solid/garage-car.svg";
import NavigationIcon from "~/static/images/icons/solid/location-arrow.svg";
import MapIcon from "~/static/images/icons/solid/map.svg";

type CameraTerminal = Pick<PublicSsrTerminal, "cameras" | "id" | "name"> & {
  mates?: readonly Pick<PublicSsrTerminal, "id">[];
};
type CameraMate = Pick<PublicSsrTerminal, "id" | "name">;

// explain departure-terminal images consistently in the browser and initial html
export const CameraOverview = ({
  inset = true,
  loading = false,
  mate,
  terminal,
}: {
  inset?: boolean;
  loading?: boolean;
  mate?: CameraMate | null;
  terminal: CameraTerminal;
}): ReactElement => {
  const terminalSlug = getStaticPublicSsrTerminalSlug(terminal.id);
  const mateSlug = mate ? getStaticPublicSsrTerminalSlug(mate.id) : undefined;
  const routePath =
    terminalSlug && mateSlug
      ? `/${terminalSlug}${terminal.mates?.length === 1 ? "" : `/${mateSlug}`}`
      : null;
  const hasCameras = loading || terminal.cameras.length > 0;
  // match the bottom bar while omitting the current camera destination
  const links = [
    ...(routePath
      ? [
          { Icon: ScheduleIcon, label: "Schedule & wait", path: routePath },
          {
            Icon: NavigationIcon,
            label: "What boat will I make?",
            path: `${routePath}/navigation`,
          },
        ]
      : []),
    ...(terminalSlug
      ? [
          {
            Icon: TerminalIcon,
            label: "Terminal info",
            path: `/${terminalSlug}/terminal`,
          },
        ]
      : []),
    ...(routePath
      ? [
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
      : []),
  ];

  return (
    <section
      className={clsx(
        "mx-auto w-full max-w-6xl border-b border-black/10 dark:border-white/10",
        inset && "p-4"
      )}
    >
      <RoutePageIntro
        title={`${terminal.name} ferry terminal cameras`}
        description={
          hasCameras
            ? `View traffic camera images at the ${terminal.name} ferry terminal${mate ? ` before departing for ${mate.name}` : ""}. Check visible vehicle lines before you travel.`
            : `No camera views are listed for the ${terminal.name} ferry terminal. Check sailing times and WSF wait reports${mate ? ` for trips to ${mate.name}` : ""} instead.`
        }
      />
      {links.length > 0 && (
        <RouteQuickLinks ariaLabel="Camera planning links" links={links} />
      )}
    </section>
  );
};
