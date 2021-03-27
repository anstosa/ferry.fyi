import { Alerts, getBulletins, getLastAlertTime, getWaitTime } from "./Alerts";
import { Cameras } from "./Cameras";
import { DateTime } from "luxon";
import { isDark } from "~/lib/theme";
import { isOnline } from "~/lib/api";
import clsx from "clsx";
import React, { FC, ReactNode, useState } from "react";
import ReactGA from "react-ga";
import type { Terminal } from "shared/models/terminals";

const WrapFooter: FC<{ isOpen: boolean }> = ({ isOpen = false, children }) => (
  <footer
    className={clsx(
      "fixed top-0 inset-x",
      "bg-green-dark text-white",
      "w-full shadow-up-lg",
      "flex justify-center",
      "animate",
      "pr-safe-right pl-safe-left mb-safe-bottom",
      isOpen ? "z-20" : "z-10"
    )}
    style={{
      height: window.innerHeight,
      top: isOpen ? "0" : "calc(100% - 4rem)",
    }}
  >
    <div
      className={clsx(
        "w-full max-w-6xl",
        "flex flex-col",
        "pt-safe-top pb-safe-bottom"
      )}
    >
      {children}
    </div>
  </footer>
);

enum Tabs {
  cameras = "cameras",
  alerts = "alerts",
}

interface Props {
  onChange: (isOpen: boolean) => void;
  terminal: Terminal;
  time: DateTime;
}

export const Footer: FC<Props> = ({ onChange, terminal, time }) => {
  const [cameraTime, setCameraTime] = useState<number>(
    DateTime.local().toSeconds()
  );
  const [isOpen, setOpen] = useState<boolean>(false);
  const [tab, setTab] = useState<Tabs | null>(null);
  const [isReloading, setReloading] = useState<boolean>(false);

  const showCameras = !isOpen || tab === Tabs.cameras;
  const showAlerts = !isOpen || tab === Tabs.alerts;

  const toggleTab = (isOpen: boolean, tab: Tabs | null = null): void => {
    setOpen(isOpen);
    setTab(tab);
    onChange?.(isOpen);
  };

  const renderToggle = (): ReactNode => {
    const showMap = !isOpen;
    return (
      <div className="flex justify-between">
        {showCameras && renderToggleCameras()}
        {showMap && renderMapLink()}
        {showAlerts && renderToggleAlerts()}
      </div>
    );
  };

  const renderMapLink = (): ReactNode => {
    const { vesselwatch } = terminal;
    if (!vesselwatch) {
      return null;
    }
    return (
      <a
        className="h-16 p-4 flex items-center"
        href={vesselwatch}
        aria-label="Open VesselWatch"
      >
        <i className="fas fa-lg fa-map-marked" />
      </a>
    );
  };

  const renderToggleCameras = (): ReactNode => {
    if (!isOnline()) {
      return null;
    }
    return (
      <div
        className={clsx(
          "relative h-16 w-16",
          "flex items-center justify-center",
          "cursor-pointer",
          "flex-no-wrap min-w-0"
        )}
        onClick={() => {
          if (isOpen) {
            toggleTab(false);
            ReactGA.event({
              category: "Navigation",
              action: "Close Cameras",
            });
          } else {
            toggleTab(true, Tabs.cameras);
            ReactGA.event({
              category: "Navigation",
              action: "Open Cameras",
            });
          }
        }}
      >
        <i
          className={clsx("fas fa-lg", isOpen ? "fa-chevron-down" : "fa-video")}
        />
        {isOpen && (
          <i
            className={clsx(
              "fas fa-redo fa-lg fa-spin cursor-pointer",
              !isReloading && "fa-spin-pause"
            )}
            aria-label="Refresh Images"
            onClick={() => {
              setReloading(true);
              setCameraTime(DateTime.local().toSeconds());
              setTimeout(() => setReloading(false), 1 * 1000);
            }}
          />
        )}
      </div>
    );
  };

  const renderToggleAlerts = (): ReactNode => {
    const bulletins = getBulletins(terminal);
    if (!bulletins.length) {
      return <div className="w-16 h-16" />;
    }

    let summary: ReactNode;

    let backgroundColor: string;
    const latest = bulletins[0];
    const hours = Math.abs(
      DateTime.fromSeconds(latest.date).diffNow().as("hours")
    );
    if (hours < 6) {
      summary = getWaitTime(latest) || getLastAlertTime(terminal);
      backgroundColor = "bg-red-dark";
    } else {
      summary = null;
      backgroundColor = "";
    }

    return (
      <div
        className={clsx(
          "relative h-16 p-4",
          "flex items-center justify-end",
          "flex-no-wrap min-w-0",
          "cursor-pointer",
          { [backgroundColor]: !isOpen, "flex-1": isOpen || summary }
        )}
        onClick={() => {
          if (isOpen) {
            toggleTab(false);
            ReactGA.event({
              category: "Navigation",
              action: "Close Alerts",
            });
          } else {
            toggleTab(true, Tabs.alerts);
            ReactGA.event({
              category: "Navigation",
              action: "Open Alerts",
            });
          }
        }}
      >
        <span className="truncate">{isOpen ? "Alerts" : summary}</span>
        <i
          className={clsx("fas fa-lg ml-4", {
            "fa-chevron-down": isOpen,
            "fa-exclamation-triangle": !isOpen,
          })}
        />
      </div>
    );
  };

  return (
    <>
      <div
        className={clsx(
          "h-16 w-full flex-shrink-0",
          isDark ? "bg-black" : "bg-white"
        )}
      />
      <WrapFooter isOpen={isOpen}>
        {renderToggle()}
        {showCameras && <Cameras terminal={terminal} cameraTime={cameraTime} />}
        {showAlerts && <Alerts terminal={terminal} time={time} />}
      </WrapFooter>
      <div className="h-safe-bottom w-full bg-green-dark" />
    </>
  );
};
