import { getSlug, getTerminals } from "~/lib/terminals";
import { Link } from "react-router-dom";
import { Menu } from "~/components/Menu";
import { ReloadButton } from "~/components/ReloadButton";
import { TerminalDropdown } from "./TerminalDropdown";
import { useOnline, useWSF } from "~/lib/api";
import ArrowRightIcon from "~/images/icons/solid/arrow-right.svg";
import clsx from "clsx";
import DirectionsIcon from "~/images/icons/solid/directions.svg";
import DumpsterFireIcon from "~/images/icons/solid/dumpster-fire.svg";
import ExchangeIcon from "~/images/icons/solid/exchange.svg";
import MenuIcon from "~/images/icons/solid/bars.svg";
import OfflineIcon from "~/images/icons/solid/signal-alt-slash.svg";
import React, { FC, ReactNode, useEffect, useState } from "react";
import ReactGA from "react-ga";
import type { Terminal } from "shared/contracts/terminals";

const WrapHeader: FC = ({ children }) => (
  <header
    className={clsx(
      "fixed top-0 inset-x-0 z-20",
      "bg-green-dark text-white",
      "w-full shadow-lg h-16",
      "flex justify-center",
      "pr-safe-right pl-safe-left mt-safe-top"
    )}
  >
    <div className={clsx("w-full max-w-6xl p-4", "flex items-center")}>
      {children}
    </div>
  </header>
);

interface Props {
  isReloading: boolean;
  mate: Terminal;
  reload: () => void;
  setRoute: (target: string, mate: string) => void;
  terminal: Terminal;
}

export const Header: FC<Props> = (props) => {
  const { isReloading, mate, reload, terminal, setRoute } = props;
  const [isMenuOpen, setMenuOpen] = useState<boolean>(false);
  const [isTerminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [isMateOpen, setMateOpen] = useState<boolean>(false);
  const [isSwapHovering, setSwapHovering] = useState<boolean>(false);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const isOnline = useOnline();
  const isWsfOffline = useWSF().offline;

  const fetchTerminals = async (): Promise<void> => {
    setTerminals(await getTerminals());
  };

  useEffect(() => {
    fetchTerminals();
  }, []);

  if (!terminal) {
    return <WrapHeader>Ferry FYI</WrapHeader>;
  }

  const renderMenuToggle = (): ReactNode => (
    <MenuIcon
      className="text-2xl inline-block mr-4 cursor-poiner"
      onClick={() => {
        setMenuOpen(true);
        ReactGA.event({
          category: "Navigation",
          action: "Open Menu",
        });
      }}
      aria-label="Open Menu"
    />
  );

  const renderTerminal = (): ReactNode => {
    return (
      <>
        <a
          className="mr-2"
          href={terminal.location.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Get Directions to ${terminal.name}`}
        >
          <DirectionsIcon />
        </a>
        <TerminalDropdown
          terminals={[
            terminal,
            ...terminals.filter(({ id }) => id !== terminal.id),
          ]}
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
        terminals={[mate, ...mates.filter(({ id }) => id !== mate.id)]}
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

  const renderReload = (): ReactNode => {
    if (!isOnline) {
      return (
        <div className="font-bold text-red-dark bg-white rounded p-2 whitespace-nowrap">
          Offline
          <DumpsterFireIcon className="inline-block ml-2" />
        </div>
      );
    }
    if (isWsfOffline) {
      return (
        <div className="font-bold text-yellow-dark bg-white rounded p-2 whitespace-nowrap">
          WSF Down
          <OfflineIcon className="inline-block ml-2" />
        </div>
      );
    }
    return (
      <ReloadButton
        isReloading={isReloading}
        ariaLabel="Refresh Data"
        onClick={() => {
          if (!isReloading) {
            reload();
            ReactGA.event({
              category: "Navigation",
              action: "Force Reload",
            });
          }
        }}
      />
    );
  };

  return (
    <>
      <div className="w-full h-safe-top" />
      <div
        className={clsx(
          "fixed top-0 inset-x-0 z-20",
          "h-safe-top",
          "bg-green-dark"
        )}
      />
      <Menu
        isOpen={isMenuOpen}
        onClose={() => {
          setMenuOpen(false);
          ReactGA.event({
            category: "Navigation",
            action: "Close Menu",
          });
        }}
      />
      <WrapHeader>
        {renderMenuToggle()}
        {renderTerminal()}
        {renderSwap()}
        {renderMate()}
        <div className="flex-grow" />
        {renderReload()}
      </WrapHeader>
      <div
        className={clsx("h-16 w-full flex-shrink-0", "bg-white dark:bg-black")}
      />
    </>
  );
};
