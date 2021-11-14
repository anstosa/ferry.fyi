import {
  Alerts,
  getBulletins,
  getLastAlertTime,
  getWaitTime,
} from "./Schedule/Alerts";
import { Cameras } from "./Schedule/Cameras";
import { DateTime } from "luxon";
import { Map } from "./Schedule/Map";
import { motion } from "framer-motion";
import { ReloadButton } from "~/components/ReloadButton";
import { useOnline } from "~/lib/api";
import { Vessel } from "shared/contracts/vessels";
import ChevronDownIcon from "~/images/icons/solid/chevron-down.svg";
import clsx from "clsx";
import MapIcon from "~/images/icons/solid/map-marked.svg";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
} from "react";
import ReactGA from "react-ga";
import VideoIcon from "~/images/icons/solid/cctv.svg";
import WarningIcon from "~/images/icons/solid/exclamation-triangle.svg";
import type { Terminal } from "shared/contracts/terminals";

interface WrapFooterProps {
  isOpen: boolean;
}

const WrapFooter: FunctionComponent<WrapFooterProps> = ({
  isOpen = false,
  children,
}) => (
  <motion.footer
    initial={{ top: "calc(100% - 4rem)" }}
    animate={{ top: isOpen ? 0 : "calc(100% - 4rem)" }}
    exit={{ top: "calc(100% - 4rem)" }}
    className={clsx(
      "fixed top-0 inset-x",
      "bg-green-dark text-white",
      "w-full shadow-up-lg",
      "flex justify-center",
      "animate",
      "pr-safe-right pl-safe-left mb-safe-bottom",
      isOpen ? "z-20" : "z-10"
    )}
    transition={{ type: "easeInOut" }}
    style={{ height: window.innerHeight }}
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
  </motion.footer>
);

enum Tabs {
  cameras = "cameras",
  map = "map",
  alerts = "alerts",
}

interface Props {
  onChange: (isOpen: boolean) => void;
  terminal: Terminal;
  mate: Terminal;
  time: DateTime;
  vessels: Vessel[];
}

export const Footer = ({
  onChange,
  terminal,
  mate,
  time,
  vessels,
}: Props): ReactElement => {
  const [cameraTime, setCameraTime] = useState<number>(
    DateTime.local().toSeconds()
  );
  const [isOpen, setOpen] = useState<boolean>(false);
  const [tab, setTab] = useState<Tabs | null>(null);
  const [isReloading, setReloading] = useState<boolean>(false);
  const isOnline = useOnline();

  const showCameras = !isOpen || tab === Tabs.cameras;
  const showMap = !isOpen || tab === Tabs.map;
  const showAlerts = !isOpen || tab === Tabs.alerts;

  const toggleTab = (isOpen: boolean, tab: Tabs | null = null): void => {
    setOpen(isOpen);
    setTab(tab);
    onChange?.(isOpen);
  };

  const renderToggle = (): ReactElement => {
    return (
      <div className="flex justify-between">
        {showCameras && renderToggleCameras()}
        {showMap && renderToggleMap()}
        {showAlerts && renderToggleAlerts()}
      </div>
    );
  };

  const renderToggleMap = (): ReactElement | null => {
    if (!isOnline) {
      return null;
    }
    return (
      <div
        className={clsx(
          "relative h-16",
          "flex items-center",
          "cursor-pointer",
          "flex-no-wrap min-w-0",
          {
            "w-16 justify-center": !isOpen,
            "p-4 w-full justify-between": isOpen,
          }
        )}
        onClick={() => {
          if (isOpen) {
            toggleTab(false);
            ReactGA.event({
              category: "Navigation",
              action: "Close Map",
            });
          } else {
            toggleTab(true, Tabs.map);
            ReactGA.event({
              category: "Navigation",
              action: "Open Map",
            });
          }
        }}
      >
        {isOpen ? (
          <>
            Map
            <ChevronDownIcon className="text-2xl" />
          </>
        ) : (
          <MapIcon className="text-2xl" />
        )}
      </div>
    );
  };

  const renderToggleCameras = (): ReactElement | null => {
    if (!isOnline) {
      return null;
    }
    return (
      <>
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
          {isOpen ? (
            <ChevronDownIcon className="text-2xl" />
          ) : (
            <VideoIcon className="text-2xl" />
          )}
        </div>
        {isOpen && (
          <div
            className={clsx(
              "relative h-16 w-16",
              "flex items-center justify-center",
              "cursor-pointer",
              "flex-no-wrap min-w-0"
            )}
          >
            <ReloadButton
              ariaLabel="RefreshImages"
              isReloading={isReloading}
              onClick={() => {
                setReloading(true);
                setCameraTime(DateTime.local().toSeconds());
                setTimeout(() => setReloading(false), 1 * 1000);
              }}
            />
          </div>
        )}
      </>
    );
  };

  const renderToggleAlerts = (): ReactElement | null => {
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
        <div className="text-2xl ml-4">
          {isOpen ? <ChevronDownIcon /> : <WarningIcon />}
        </div>
      </div>
    );
  };

  return (
    <>
      <div
        className={clsx("h-16 w-full flex-shrink-0", "bg-white dark:bg-black")}
      />
      <WrapFooter isOpen={isOpen}>
        {renderToggle()}
        {isOpen && tab === Tabs.cameras && (
          <Cameras terminal={terminal} cameraTime={cameraTime} />
        )}
        {isOpen && tab === Tabs.map && (
          <Map terminal={terminal} mate={mate} vessels={vessels} />
        )}
        {isOpen && tab === Tabs.alerts && (
          <Alerts terminal={terminal} time={time} />
        )}
      </WrapFooter>
      <div className="h-safe-bottom w-full bg-green-dark" />
    </>
  );
};
