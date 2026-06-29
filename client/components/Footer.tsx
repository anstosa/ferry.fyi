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

import BellAlertIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-week.svg";
import VideoIcon from "~/static/images/icons/solid/cctv.svg";
import TerminalIcon from "~/static/images/icons/solid/garage-car.svg";
import MapIcon from "~/static/images/icons/solid/route.svg";
import { GetPath } from "~/views/Route";

import { getLastBulletinTime, getWaitTime } from "../views/Bulletins";

const WrapFooter: FunctionComponent<PropsWithChildren> = ({ children }) => (
  <footer
    className={clsx(
      "fixed bottom-0 inset-x-0 z-10",
      "bg-[linear-gradient(135deg,#016f52_0%,#004d61_32%,#004d61_100%)] text-white",
      "h-[calc(4rem+env(safe-area-inset-bottom))] w-full border-t border-[rgba(255,255,255,0.12)] shadow-up-lg",
      "flex justify-center",
      "animate",
      "pr-safe-right pl-safe-left"
    )}
  >
    <div className={clsx("h-16 w-full max-w-6xl", "flex justify-between")}>
      {children}
    </div>
  </footer>
);

// active tab underline
const FooterSelection = (): ReactElement => (
  <motion.span
    className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-countdown"
    layoutId="footer-selection"
    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
  />
);

// footer nav item
const FooterLink: FunctionComponent<PropsWithChildren<{ path: string }>> = ({
  path,
  children,
}) => (
  <NavLink
    to={path}
    end
    className={({ isActive }) =>
      clsx(
        "relative flex h-16 items-center justify-center border-y-4 border-transparent p-4",
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

export const Footer = ({ terminal, getPath }: Props): ReactElement => {
  const renderBulletins = (): ReactElement | null => {
    const { bulletins } = terminal;

    if (!bulletins.length) {
      return null;
    }

    let summary: ReactNode;

    let backgroundColor: string;
    const latest = bulletins[0];
    const hours = Math.abs(
      DateTime.fromSeconds(latest.date).diffNow().as("hours")
    );
    if (hours < 6) {
      summary = getWaitTime(latest) || getLastBulletinTime(terminal);
      backgroundColor = "bg-stale-light dark:bg-stale-dark";
    } else {
      summary = null;
      backgroundColor = "";
    }

    return (
      <NavLink
        className={({ isActive }) =>
          clsx(
            "relative flex h-16 min-w-0 flex-no-wrap cursor-pointer items-center justify-end p-4",
            isActive ? "text-white" : "text-lighten-high",
            backgroundColor
          )
        }
        to={getPath({ view: "alerts" })}
      >
        {({ isActive }) => (
          <>
            {summary && <span className="mr-2 truncate">{summary}</span>}
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
          <FooterLink path={getPath({ view: "schedule" })}>
            <ScheduleIcon className="text-2xl" />
          </FooterLink>
          <FooterLink path={getPath({ view: "cameras" })}>
            <VideoIcon className="text-2xl" />
          </FooterLink>
          <FooterLink path={getPath({ view: "terminal" })}>
            <TerminalIcon className="text-2xl" />
          </FooterLink>
          <FooterLink path={getPath({ view: "map" })}>
            <MapIcon className="text-2xl" />
          </FooterLink>
          {/* flexible spacer */}
          <div className="flex-1" />
          {renderBulletins()}
        </LayoutGroup>
      </WrapFooter>
      <div className="h-safe-bottom w-full bg-blue-dark" />
    </>
  );
};
