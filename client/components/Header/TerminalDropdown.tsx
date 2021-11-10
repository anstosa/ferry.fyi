import { AnimatePresence, motion } from "framer-motion";
import { getSlug } from "~/lib/terminals";
import { Link } from "react-router-dom";
import CaretDownIcon from "~/images/icons/solid/caret-down.svg";
import CaretUpIcon from "~/images/icons/solid/caret-up.svg";
import clsx from "clsx";
import React, { MouseEvent, ReactElement } from "react";
import type { Terminal } from "shared/contracts/terminals";

interface Props {
  terminals: Terminal[];
  isOpen: boolean;
  setOpen: (state: boolean) => void;
  onSelect: (event: MouseEvent, terminal: Terminal) => void;
}

export const TerminalDropdown = (props: Props): ReactElement => {
  const { terminals, isOpen, setOpen, onSelect } = props;
  const selectedTerminal = terminals[0];
  if (terminals.length === 1) {
    return <span className="truncate">{selectedTerminal.name}</span>;
  }
  const otherTerminals = terminals.filter(
    ({ id }) => id !== selectedTerminal.id
  );
  return (
    <div className="relative cursor-pointer min-w-0">
      <div
        className="min-w-0 flex items-center"
        onClick={() => setOpen(!isOpen)}
        aria-label="Expand Terminals"
      >
        <span className="truncate">{selectedTerminal.name}</span>
        <div className="inline-block ml-2">
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
              "-ml-4 py-2",
              "flex items-stretch",
              "max-h-halfscreen"
            )}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "easeInOut" }}
          >
            <ul className={clsx("overflow-y-scroll scrolling-touch", "pb-5")}>
              {otherTerminals.map((terminal) => {
                const { id, name } = terminal;
                return (
                  <li key={id}>
                    <Link
                      className={clsx(
                        "whitespace-nowrap",
                        "block cursor-pointer",
                        "px-4 py-2",
                        "hover:bg-lighten-high"
                      )}
                      to={`/${getSlug(id)}`}
                      onClick={(event) => onSelect(event, terminal)}
                    >
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
