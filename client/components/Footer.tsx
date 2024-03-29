import { colors } from "~/lib/theme";
import { DateTime } from "luxon";
import { getLastBulletinTime, getWaitTime } from "../views/Bulletins";
import { GetPath } from "~/views/Route";
import { NavLink } from "react-router-dom";
import clsx from "clsx";
import MapIcon from "~/static/images/icons/solid/map-marked.svg";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import ScheduleIcon from "~/static/images/icons/solid/calendar-week.svg";
import VideoIcon from "~/static/images/icons/solid/cctv.svg";
import WarningIcon from "~/static/images/icons/solid/exclamation-triangle.svg";
import type { Terminal } from "shared/contracts/terminals";

const WrapFooter: FunctionComponent = ({ children }) => (
  <footer
    className={clsx(
      "fixed bottom-0 inset-x z-10",
      "bg-green-dark text-white",
      "w-full shadow-up-lg h-16",
      "flex justify-center",
      "animate",
      "pr-safe-right pl-safe-left mb-safe-bottom",
      "pwa:mb-0"
    )}
  >
    <div
      className={clsx(
        "w-full max-w-6xl",
        "flex justify-between",
        "pt-safe-top pb-safe-bottom",
        "pwa:pt-0 pwa:pb-0"
      )}
    >
      {children}
    </div>
  </footer>
);

const FooterLink: FunctionComponent<{ path: string }> = ({
  path,
  children,
}) => (
  <NavLink
    to={path}
    end
    className="p-4 border-t-4 border-b-4 border-transparent"
    style={({ isActive }) => ({
      color: isActive ? colors.white : colors.lighten.medium,
      borderBottomColor: isActive ? colors.white : "transparent",
    })}
  >
    {children}
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
      backgroundColor = "bg-red-dark";
    } else {
      summary = null;
      backgroundColor = "";
    }

    return (
      <NavLink
        className={clsx(
          "relative h-16 p-4",
          "flex items-center justify-end",
          "flex-no-wrap min-w-0",
          "cursor-pointer",
          backgroundColor,
          { "flex-1": summary }
        )}
        to={getPath({ view: "alerts" })}
      >
        {summary && <span className="truncate mr-2">{summary}</span>}
        <WarningIcon className="text-2xl" />
      </NavLink>
    );
  };

  return (
    <>
      <div
        className={clsx("h-16 w-full flex-shrink-0", "bg-white dark:bg-black")}
      />
      <WrapFooter>
        <FooterLink path={getPath({ view: "schedule" })}>
          <ScheduleIcon className="text-2xl" />
        </FooterLink>
        <FooterLink path={getPath({ view: "cameras" })}>
          <VideoIcon className="text-2xl" />
        </FooterLink>
        <FooterLink path={getPath({ view: "map" })}>
          <MapIcon className="text-2xl" />
        </FooterLink>
        {renderBulletins()}
      </WrapFooter>
      <div className="h-safe-bottom w-full bg-green-dark" />
    </>
  );
};
