import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import React, {
  FunctionComponent,
  MouseEvent,
  ReactElement,
  SVGAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import type { Terminal } from "shared/contracts/terminals";
import { isEmpty } from "shared/lib/arrays";

import { getSlug } from "~/lib/terminals";
import { useWindowSize } from "~/lib/window";
import CaretDownIcon from "~/static/images/icons/solid/caret-down.svg";
import CaretUpIcon from "~/static/images/icons/solid/caret-up.svg";

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
  const terminalListRef = useRef<HTMLUListElement | null>(null);
  const [needsScroll, setNeedsScroll] = useState(false);

  const updateScrollState = useCallback((): void => {
    const terminalList = terminalListRef.current;
    // missing list guard
    if (!terminalList) {
      setNeedsScroll(false);
      return;
    }
    setNeedsScroll(terminalList.scrollHeight > terminalList.clientHeight + 1);
  }, []);

  useEffect(() => {
    // closed menu guard
    if (!isOpen) {
      setNeedsScroll(false);
      return;
    }
    updateScrollState();
    const terminalList = terminalListRef.current;
    // missing observer guard
    if (!terminalList) {
      return;
    }
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(terminalList);
    return () => observer.disconnect();
  }, [isOpen, terminals, updateScrollState, width]);

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
              "-ml-2 py-2",
              "flex items-stretch",
              "max-h-screen"
            )}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut", type: "tween" }}
            onAnimationComplete={updateScrollState}
          >
            <ul
              ref={terminalListRef}
              className={clsx(
                "overflow-y-auto scrolling-touch",
                needsScroll && "pb-5"
              )}
            >
              {terminals.map(({ Icon, terminal }) => {
                const { id, name } = terminal;
                return (
                  <li key={id}>
                    <Link
                      className={clsx(
                        "whitespace-nowrap",
                        "block cursor-pointer",
                        "p-2",
                        "hover:bg-lighten-high",
                        "flex items-center"
                      )}
                      to={`/${getSlug(id)}`}
                      onClick={(event) => onSelect(event, terminal)}
                    >
                      {name}
                      {/* optional terminal icon */}
                      {Icon && <Icon className="ml-3" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {/* scroll affordance */}
            {needsScroll && (
              <div
                className={clsx(
                  "absolute bottom-0 left-0",
                  "w-full h-8",
                  "pointer-events-none",
                  "bg-gradient-to-b from-transparent to-green-dark"
                )}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
