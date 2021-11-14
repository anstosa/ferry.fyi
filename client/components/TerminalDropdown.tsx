import { AnimatePresence, motion } from "framer-motion";
import { getSlug } from "~/lib/terminals";
import { isEmpty } from "shared/lib/arrays";
import { Link } from "react-router-dom";
import { useWindowSize } from "~/lib/window";
import CaretDownIcon from "~/images/icons/solid/caret-down.svg";
import CaretUpIcon from "~/images/icons/solid/caret-up.svg";
import clsx from "clsx";
import React, {
  FunctionComponent,
  MouseEvent,
  ReactElement,
  SVGAttributes,
} from "react";
import type { Terminal } from "shared/contracts/terminals";

const ABBREVIATION_BREAKPOINT = 350;

export interface TerminalOption {
  Icon?: FunctionComponent<SVGAttributes<SVGElement>>;
  terminal: Terminal;
}

interface Props {
  terminals: TerminalOption[];
  selected: Terminal;
  isOpen: boolean;
  setOpen: (state: boolean) => void;
  onSelect: (event: MouseEvent, terminal: Terminal) => void;
}

export const TerminalDropdown = (props: Props): ReactElement => {
  const { terminals, isOpen, selected, setOpen, onSelect } = props;
  const { width } = useWindowSize();

  if (isEmpty(terminals)) {
    return (
      <span className="truncate">
        {width > ABBREVIATION_BREAKPOINT
          ? selected.name
          : selected.abbreviation}
      </span>
    );
  }
  return (
    <div className="relative cursor-pointer min-w-0">
      <div
        className="min-w-0 flex items-center"
        onClick={(event) => {
          if (terminals.length === 1) {
            onSelect(event, terminals[0].terminal);
          } else {
            setOpen(!isOpen);
          }
        }}
        aria-label="Expand Terminals"
      >
        <span className="truncate">
          {width > ABBREVIATION_BREAKPOINT
            ? selected.name
            : selected.abbreviation}
        </span>
        <div
          className={clsx(
            "absolute top-full -mt-1 flex justify-center w-full",
            "text-lighten-medium"
          )}
        >
          {isOpen ? <CaretUpIcon /> : <CaretDownIcon />}
        </div>
      </div>
      {/* Background overlay. Click to close */}
      {isOpen && (
        <div
          className={clsx(
            "fixed w-screen h-screen top-0 left-0",
            "cursor-default"
          )}
          onClick={() => setOpen(false)}
        />
      )}
      {/* The actual dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className={clsx(
              "absolute top-full left-0",
              "bg-green-dark shadow-lg",
              "-ml-11 py-2",
              "flex items-stretch",
              "max-h-halfscreen"
            )}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "easeInOut" }}
          >
            <ul className={clsx("overflow-y-scroll scrolling-touch", "pb-5")}>
              {terminals.map(({ Icon, terminal }) => {
                const { id, name } = terminal;
                return (
                  <li key={id}>
                    <Link
                      className={clsx(
                        "whitespace-nowrap",
                        "block cursor-pointer",
                        "px-4 py-2",
                        "hover:bg-lighten-high",
                        "flex items-center"
                      )}
                      to={`/${getSlug(id)}`}
                      onClick={(event) => onSelect(event, terminal)}
                    >
                      {Icon ? (
                        <Icon className="mr-3" />
                      ) : (
                        <div className="w-4 mr-3" />
                      )}
                      {name}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div
              className={clsx(
                "absolute bottom-0 left-0",
                "w-full h-8",
                "pointer-events-none",
                "bg-gradient-to-b from-transparent to-green-dark"
              )}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
