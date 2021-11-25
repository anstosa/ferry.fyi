import { AnimatePresence } from "framer-motion";
import { getSlug, useTerminals } from "~/lib/terminals";
import { getTerminalSorter } from "../lib/terminals";
import { isNull } from "shared/lib/identity";
import { Link } from "react-router-dom";
import { Notification } from "~/components/Notification";
import { TerminalDropdown } from "./TerminalDropdown";
import { without } from "shared/lib/arrays";
import ArrowRightIcon from "~/images/icons/solid/arrow-right.svg";
import clsx from "clsx";
import ExchangeIcon from "~/images/icons/solid/exchange.svg";
import LocationIcon from "~/images/icons/solid/location.svg";
import React, { ReactElement, ReactNode, useEffect, useState } from "react";
import ReactGA from "react-ga";
import type { Terminal } from "shared/contracts/terminals";

interface Props {
  mate: Terminal;
  setRoute: (target: string, mate: string) => void;
  terminal: Terminal;
}

export const RouteSelector = (props: Props): ReactElement => {
  const { mate, terminal, setRoute } = props;
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [isMateOpen, setMateOpen] = useState<boolean>(false);
  const [isSwapHovering, setSwapHovering] = useState<boolean>(false);
  const [closestDismissed, setClosestDismissed] = useState<boolean>(false);
  const { terminals, closestTerminal } = useTerminals();

  useEffect(() => {
    if (closestTerminal?.id === terminal.id) {
      setClosestDismissed(true);
    }
  }, [location, terminals]);

  const renderTerminal = (): ReactNode => {
    return (
      <>
        <TerminalDropdown
          terminals={without(terminals, terminal, "id").map((terminal) => ({
            ...(terminal.id === closestTerminal?.id && {
              Icon: LocationIcon,
            }),
            terminal,
          }))}
          selected={terminal}
          isOpen={isTerminalOpen}
          setOpen={setTerminalOpen}
          onSelect={() => setTerminalOpen(false)}
        />
      </>
    );
  };

  const renderSwap = (): ReactNode => {
    if (!mate) {
      return null;
    }
    return (
      <Link
        className="mx-2 w-8 text-center"
        to={`/${getSlug(mate.id)}`}
        onMouseEnter={() => setSwapHovering(true)}
        onMouseLeave={() => setSwapHovering(false)}
        onClick={() =>
          ReactGA.event({
            category: "Navigation",
            action: "Swap Terminals",
          })
        }
        aria-label="Swap Terminals"
      >
        {isSwapHovering ? <ExchangeIcon /> : <ArrowRightIcon />}
      </Link>
    );
  };

  const renderMate = (): ReactNode => {
    if (!mate) {
      return null;
    }
    const { mates = [] } = terminal;
    return (
      <TerminalDropdown
        terminals={without(mates.sort(getTerminalSorter()), mate, "id").map(
          (terminal) => ({
            terminal,
          })
        )}
        selected={mate}
        isOpen={isMateOpen}
        setOpen={setMateOpen}
        onSelect={(event, selectedTerminal) => {
          event.preventDefault();
          setMateOpen(false);
          setRoute(getSlug(terminal.id), getSlug(selectedTerminal.id));
        }}
      />
    );
  };

  return (
    <>
      {renderTerminal()}
      {renderSwap()}
      {renderMate()}
      <AnimatePresence>
        {!isNull(closestTerminal) &&
          closestTerminal.id !== terminal.id &&
          !closestDismissed && (
            <Notification info>
              Looks like your closest terminal is {closestTerminal.name}.
              <div className="button-group mt-5">
                <Link
                  className={clsx(
                    "button button-group-left",
                    "truncate",
                    "bg-blue-dark border-transparent text-white",
                    "hover:bg-blue-darkest"
                  )}
                  to={`/${getSlug(closestTerminal.id)}`}
                >
                  <LocationIcon className="button-icon" />
                  <span className="button-label">
                    Switch to {closestTerminal?.name}
                  </span>
                </Link>

                <button
                  className="button button-group-right truncate"
                  onClick={() => setClosestDismissed(true)}
                >
                  Stay on {terminal.name}
                </button>
              </div>
            </Notification>
          )}
      </AnimatePresence>
    </>
  );
};
