import { getSlug, getTerminals } from "./lib/terminals";
import { isDark } from "~/lib/theme";
import { isOnline } from "~/lib/api";
import { Link } from "react-router-dom";
import { Menu } from "./Menu";
import clsx from "clsx";
import React, { FC, MouseEvent, ReactNode, useEffect, useState } from "react";
import ReactGA from "react-ga";
import type { Terminal } from "shared/models/terminals";

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

  const fetchTerminals = async (): Promise<void> => {
    setTerminals(await getTerminals());
  };

  useEffect(() => {
    fetchTerminals();
  }, []);

  if (!terminal) {
    return <WrapHeader>Ferry FYI</WrapHeader>;
  }

  const renderDropdown = (
    terminals: Terminal[],
    isOpen: boolean,
    setOpen: (state: boolean) => void,
    onSelect: (event: MouseEvent, terminal: Terminal) => void
  ): ReactNode => {
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
          <i
            className={clsx(`fas fa-caret-${isOpen ? "up" : "down"}`, "ml-2")}
          />
        </div>
        {isOpen && (
          <div
            className={clsx(
              "absolute top-full left-0",
              "bg-green-dark shadow-lg",
              "-ml-4 py-2",
              "max-h-halfscreen",
              "flex items-stretch"
            )}
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
                "bg-overscroll-gradient"
              )}
            />
          </div>
        )}
      </div>
    );
  };

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
          <i className="fas fa-directions" />
        </a>
        {renderDropdown(
          [terminal, ...terminals.filter(({ id }) => id !== terminal.id)],
          isTerminalOpen,
          setTerminalOpen,
          () => setTerminalOpen(false)
        )}
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
        <i
          className={clsx("fas", {
            "fa-exchange-alt": isSwapHovering,
            "fa-arrow-right": !isSwapHovering,
          })}
        />
      </Link>
    );
  };

  const renderMate = (): ReactNode => {
    if (!mate) {
      return null;
    }
    const { mates = [] } = terminal;
    return renderDropdown(
      [mate, ...mates.filter(({ id }) => id !== mate.id)],
      isMateOpen,
      setMateOpen,
      (event, selectedTerminal) => {
        event.preventDefault();
        setMateOpen(false);
        setRoute(getSlug(terminal.id), getSlug(selectedTerminal.id));
      }
    );
  };

  const renderMenuToggle = (): ReactNode => (
    <i
      className="fas fa-bars fa-lg mr-4 cursor-pointer"
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

  const renderReload = (): ReactNode => {
    if (!isOnline()) {
      return (
        <div className="font-bold text-red-dark bg-white rounded p-2">
          Offline
          <i className="fas fa-signal-alt-slash ml-2" />
        </div>
      );
    }
    return (
      <i
        className={clsx(
          "fas fa-redo fa-lg fa-spin cursor-pointer ml-4",
          !isReloading && "fa-spin-pause"
        )}
        aria-label="Refresh Data"
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
        className={clsx(
          "h-16 w-full flex-shrink-0",
          isDark ? "bg-black" : "bg-white"
        )}
      />
    </>
  );
};
