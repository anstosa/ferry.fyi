import clsx from "clsx";
import { LayoutGroup, motion } from "framer-motion";
import { DateTime } from "luxon";
import React, {
  FunctionComponent,
  PropsWithChildren,
  ReactElement,
  ReactNode,
} from "react";
import { NavLink } from "react-router-dom";
import type { Terminal } from "shared/contracts/terminals";
import { isSuppressedBulletin } from "shared/lib/bulletins";

import {
  type GetPath,
  ROUTE_VIEW_ORDER,
  type RouteView,
} from "~/lib/routeViews";
import BellAlertIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-week.svg";
import VideoIcon from "~/static/images/icons/solid/cctv.svg";
import FareIcon from "~/static/images/icons/solid/dollar-sign.svg";
import TerminalIcon from "~/static/images/icons/solid/garage-car.svg";
import NavigationIcon from "~/static/images/icons/solid/location-arrow.svg";
import MapIcon from "~/static/images/icons/solid/map.svg";

import { getBulletinTime, getWaitTime } from "../lib/bulletins";

// dock route navigation above the native inset
const WrapFooter: FunctionComponent<PropsWithChildren> = ({ children }) => (
  <footer
    className={clsx(
      "fixed bottom-0 inset-x-0 z-10",
      "bg-ferry-footer-gradient text-white",
      // honor native bottom inset
      "h-[calc(var(--route-footer-height)+var(--safe-area-inset-bottom))] w-full border-t border-[rgba(255,255,255,0.12)] shadow-up-lg",
      "flex justify-center",
      "animate",
      "pr-safe-right pl-safe-left"
    )}
  >
    <nav
      aria-label="Route navigation"
      className="mx-auto flex h-16 w-full max-w-6xl justify-between"
    >
      {children}
    </nav>
  </footer>
);

// active tab underline
const FooterSelection = (): ReactElement => (
  <motion.span
    className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-white/45"
    layoutId="footer-selection"
    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
  />
);

// footer nav item
const FooterLink: FunctionComponent<
  PropsWithChildren<{ label?: string; path: string }>
> = ({ path, label, children }) => (
  <NavLink
    aria-label={label}
    to={path}
    end
    className={({ isActive }) =>
      clsx(
        "relative flex h-16 min-w-0 flex-1 items-center justify-center border-y-4 border-transparent px-2 sm:px-4",
        isActive ? "text-white" : "text-lighten-high"
      )
    }
  >
    {({ isActive }) => (
      <>
        {children}
        {isActive && <FooterSelection />}
      </>
    )}
  </NavLink>
);

interface Props {
  terminal: Terminal;
  getPath: GetPath;
}

interface FooterLinkDefinition {
  decorative?: boolean;
  Icon: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  label: string;
}

// map visible footer destinations onto the canonical route order
const FOOTER_LINKS: Partial<Record<RouteView, FooterLinkDefinition>> = {
  schedule: { Icon: ScheduleIcon, label: "Schedule" },
  navigation: {
    decorative: true,
    Icon: NavigationIcon,
    label: "Navigation",
  },
  cameras: { Icon: VideoIcon, label: "Cameras" },
  terminal: { Icon: TerminalIcon, label: "Terminal details" },
  map: { Icon: MapIcon, label: "Map" },
  fare: { Icon: FareIcon, label: "Fares" },
};

// fit every route tab within compact mobile screens
export const Footer = ({ terminal, getPath }: Props): ReactElement => {
  // summarize only publishable terminal bulletins including cached responses
  const renderBulletins = (): ReactElement | null => {
    // exclude suppressed bulletins before selecting the latest alert
    const bulletins = terminal.bulletins.filter(
      (bulletin) => !isSuppressedBulletin(bulletin)
    );

    // omit the empty bulletin tab
    if (!bulletins.length) {
      return null;
    }

    let summary: ReactNode;

    let backgroundColor: string;
    const latest = bulletins[0];
    const hours = Math.abs(
      DateTime.fromSeconds(latest.date).diffNow().as("hours")
    );
    // highlight recent bulletin context
    if (hours < 6) {
      summary = getWaitTime(latest) || getBulletinTime(latest);
      backgroundColor = "bg-stale-light dark:bg-stale-dark";
    } else {
      summary = null;
      backgroundColor = "";
    }

    return (
      <NavLink
        aria-label="Alerts and bulletins"
        className={({ isActive }) =>
          clsx(
            "relative flex h-16 min-w-0 flex-1 flex-no-wrap cursor-pointer items-center justify-center border-y-4 border-transparent px-2 sm:px-4",
            isActive ? "text-white" : "text-lighten-high",
            backgroundColor
          )
        }
        to={getPath({ view: "alerts" })}
      >
        {({ isActive }) => (
          <>
            {/* keep all navigation icons reachable on narrow screens */}
            {summary && (
              <span className="mr-2 hidden truncate sm:inline">{summary}</span>
            )}
            <BellAlertIcon className="text-2xl" />
            {isActive && <FooterSelection />}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <>
      <div
        className={clsx(
          "h-16 w-full flex-shrink-0",
          "bg-day-normal-light dark:bg-night-normal-dark"
        )}
      />
      <WrapFooter>
        <LayoutGroup id="footer-nav">
          {ROUTE_VIEW_ORDER.map((view) => {
            // retain the conditional alert destination in its canonical position
            if (view === "alerts") {
              return (
                <React.Fragment key={view}>{renderBulletins()}</React.Fragment>
              );
            }
            const definition = FOOTER_LINKS[view];
            // omit subscribe and any non-footer destinations
            if (!definition) {
              return null;
            }
            const { decorative, Icon, label } = definition;
            return (
              <FooterLink key={view} label={label} path={getPath({ view })}>
                <Icon
                  aria-hidden={decorative || undefined}
                  className="text-2xl"
                />
              </FooterLink>
            );
          })}
        </LayoutGroup>
      </WrapFooter>
      {/* reserve native bottom inset */}
      <div className="h-safe-bottom w-full flex-shrink-0 bg-ferry-footer-gradient" />
    </>
  );
};
