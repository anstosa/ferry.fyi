import { AnimatePresence, motion } from "framer-motion";
import { colors } from "~/lib/theme";
import { InstallInstructions } from "./InstallInstructions";
import { Link } from "react-router-dom";
import AboutIcon from "~/images/icons/solid/address-card.svg";
import ChevronLeftIcon from "~/images/icons/solid/chevron-left.svg";
import clsx from "clsx";
import FeedbackIcon from "~/images/icons/solid/question-circle.svg";
import React, { FunctionComponent, ReactElement, SVGAttributes } from "react";
import ReloadIcon from "~/images/icons/solid/redo.svg";
import ScheduleIcon from "~/images/icons/solid/calendar-alt.svg";
import ShipIcon from "~/images/icons/solid/ship.svg";

interface Props {
  isOpen: boolean;
  reload?: () => void;
  onClose: () => void;
}

interface MenuItem {
  Icon: FunctionComponent<SVGAttributes<SVGElement>>;
  label: string;
  path: string;
}

const NAVIGATION: MenuItem[] = [
  {
    Icon: ScheduleIcon,
    label: "Schedule",
    path: "/",
  },
  {
    Icon: AboutIcon,
    label: "About",
    path: "/about",
  },
  {
    Icon: FeedbackIcon,
    label: "Feedback",
    path: "/feedback",
  },
];

export const Menu = ({
  isOpen,
  onClose,
  reload,
}: Props): ReactElement | null => {
  return (
    <AnimatePresence>
      <>
        {isOpen && (
          <motion.div
            className={clsx(
              "fixed inset-0",
              isOpen ? "z-30" : "z-bottom pointer-events-none"
            )}
            initial={{ backdropFilter: "blur(0)", background: "transparent" }}
            animate={{
              backdropFilter: "blur(5px)",
              backgroundColor: colors.darken.low,
            }}
            exit={{ backdropFilter: "blur(0)", background: "transparent" }}
            transition={{ type: "linear" }}
            onClick={onClose}
          />
        )}
        {isOpen && (
          <motion.nav
            initial={{ left: "-100%" }}
            animate={{ left: 0 }}
            exit={{ left: "-100%" }}
            transition={{ type: "easeOut" }}
            className={clsx(
              "animate",
              "flex flex-col",
              "bg-green-dark text-white shadow-lg",
              "w-full h-screen max-w-xs",
              "fixed top-0 z-30",
              "pt-safe-top pb-safe-bottom pl-safe-left"
            )}
          >
            <div
              className={clsx(
                "h-16 w-full p-4",
                "text-2xl",
                "flex items-center"
              )}
            >
              <ShipIcon className="inline-block mr-4" />
              <h1 className="font-bold">Ferry FYI</h1>
              <div className="flex-grow" />
              <ChevronLeftIcon
                className="cursor-pointer text-md"
                onClick={onClose}
                aria-label="Close Menu"
              />
            </div>
            <div
              className={clsx(
                "overflow-y-auto scrolling-touch px-4",
                "flex-grow flex flex-col"
              )}
            >
              <ul>
                {NAVIGATION.map(({ Icon, label, path }) => (
                  <li key={label}>
                    <Link
                      to={path}
                      className={clsx("flex py-4 hover:bg-lighten-lower")}
                    >
                      <Icon className="mr-4 text-2xl" />
                      <span className="flex-grow text-xl">{label}</span>
                    </Link>
                  </li>
                ))}
                {reload && (
                  <li>
                    <div
                      onClick={() => {
                        reload();
                        onClose();
                      }}
                      className={clsx("flex py-4 hover:bg-lighten-lower")}
                    >
                      <ReloadIcon className="mr-4 text-2xl" />
                      <span className="flex-grow text-xl">Refresh Data</span>
                    </div>
                  </li>
                )}
              </ul>
              <div className="flex-grow" />
              <InstallInstructions />
            </div>
          </motion.nav>
        )}
      </>
    </AnimatePresence>
  );
};
