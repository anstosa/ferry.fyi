import { AnimatePresence } from "framer-motion";
import React, {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import type { Terminal } from "shared/contracts/terminals";
import { without } from "shared/lib/arrays";
import { isNull, isUndefined } from "shared/lib/identity";
import { getTerminalSorter } from "shared/lib/terminalSorting";

import { Prompt } from "~/components/Prompt";
import { trackEvent } from "~/lib/analytics";
import { useLocalStorage } from "~/lib/browser";
import { hasGeoPermissions, useGeo } from "~/lib/geo";
import { useAppRenderContext } from "~/lib/renderContext";
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

/** terminal route controls */
export const RouteSelector = (props: Props): ReactElement => {
  const { mate, terminal, setRoute } = props;
  const { platform } = useAppRenderContext();
  const [location, updateGeo] = useGeo();
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [isMateOpen, setMateOpen] = useState<boolean>(false);
  const [isSwapHovering, setSwapHovering] = useState<boolean>(false);
  const [closestDismissed, setClosestDismissed] = useState<boolean>(false);
  const [locationPromptEligible, setLocationPromptEligible] =
    useState<boolean>(false);
  const locationRequestStarted = useRef(false);
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

  useEffect(() => {
    if (!isUndefined(noLocation)) {
      setLocationPromptEligible(false);
      return;
    }

    let active = true;
    hasGeoPermissions().then((permissionGranted) => {
      if (!active) {
        return;
      }
      if (permissionGranted) {
        saveNoLocation(false);
        // The system grant is already present, so activate location features
        // without showing an app-level permission prompt.
        updateGeo(false);
        return;
      }
      setLocationPromptEligible(true);
    });

    return () => {
      active = false;
    };
  }, [noLocation]);

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
          trackEvent("Navigation", "Swap Terminals");
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
        {isUndefined(noLocation) && locationPromptEligible && (
          <Prompt
            key="location-permission"
            footerDocked
            actions={[
              {
                Icon: LocationIcon,
                label: platform === "ios" ? "Continue" : "Sure!",
                onClick: () => {
                  if (locationRequestStarted.current) {
                    return;
                  }
                  locationRequestStarted.current = true;
                  saveNoLocation(false);
                  // Browser and native permission APIs must be invoked by the
                  // click itself. Deferring until after the toast transition
                  // can be rejected without ever showing a system prompt.
                  updateGeo(false, true);
                },
                primary: true,
              },
              // ios must continue to the system prompt
              ...(platform === "ios"
                ? []
                : [
                    {
                      label: "No thanks",
                      onClick: () => {
                        // remember the non-ios dismissal
                        saveNoLocation(true);
                      },
                    },
                  ]),
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
