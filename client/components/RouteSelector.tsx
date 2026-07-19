import { AnimatePresence } from "framer-motion";
import React, { ReactElement, ReactNode, useEffect, useState } from "react";
import ReactGA from "react-ga4";
import { Link } from "react-router-dom";
import type { Terminal } from "shared/contracts/terminals";
import { without } from "shared/lib/arrays";
import { isNull, isUndefined } from "shared/lib/identity";
import { getTerminalSorter } from "shared/lib/terminalSorting";

import { Prompt } from "~/components/Prompt";
import { useLocalStorage } from "~/lib/browser";
import { useGeo } from "~/lib/geo";
import { getSlug, useTerminals } from "~/lib/terminals";
import ArrowRightIcon from "~/static/images/icons/solid/arrow-right.svg";
import ExchangeIcon from "~/static/images/icons/solid/exchange.svg";
import LocationIcon from "~/static/images/icons/solid/location.svg";

import { TerminalDropdown } from "./TerminalDropdown";

interface Props {
  mate: Terminal;
  setRoute: (target: string, mate?: string) => void | Promise<void>;
  terminal: Terminal;
}

export const RouteSelector = (props: Props): ReactElement => {
  const { mate, terminal, setRoute } = props;
  const [, updateGeo] = useGeo();
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [isMateOpen, setMateOpen] = useState<boolean>(false);
  const [isSwapHovering, setSwapHovering] = useState<boolean>(false);
  const [closestDismissed, setClosestDismissed] = useState<boolean>(false);
  const { terminals, closestTerminal } = useTerminals();
  const [noLocation, saveNoLocation] = useLocalStorage<boolean | undefined>(
    "noLocation",
    undefined
  );

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
          onSelect={(event, selectedTerminal) => {
            event.preventDefault();
            setTerminalOpen(false);
            setRoute(getSlug(selectedTerminal.id));
          }}
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
        onClick={(event) => {
          event.preventDefault();
          ReactGA.event({
            category: "Navigation",
            action: "Swap Terminals",
          });
          setRoute(getSlug(mate.id), getSlug(terminal.id));
        }}
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
            <Prompt
              key="closest-terminal"
              footerDocked
              actions={[
                {
                  Icon: LocationIcon,
                  label: `Switch to ${closestTerminal.name}`,
                  primary: true,
                  to: `/${getSlug(closestTerminal.id)}`,
                },
                {
                  label: "Stay here",
                  onClick: () => setClosestDismissed(true),
                },
              ]}
            >
              Looks like your closest terminal is {closestTerminal.name}.
            </Prompt>
          )}
        {isUndefined(noLocation) && (
          <Prompt
            key="location-permission"
            footerDocked
            actions={[
              {
                Icon: LocationIcon,
                label: "Sure!",
                onClick: () => {
                  saveNoLocation(false);
                  updateGeo(false);
                },
                primary: true,
              },
              { label: "No thanks", onClick: () => saveNoLocation(true) },
            ]}
            title="Enable location features?"
          >
            This will highlight nearby terminals and warn you when you're not
            looking at the closest terminal
          </Prompt>
        )}
      </AnimatePresence>
    </>
  );
};
