import { getSlug, useTerminals } from "~/lib/terminals";
import { Link } from "react-router-dom";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import clsx from "clsx";
import LocationIcon from "~/static/images/icons/solid/location.svg";
import logo from "~/static/images/icon_monochrome.png";
import React, { ReactElement } from "react";
import TicketIcon from "~/static/images/icons/solid/barcode-alt.svg";

interface TerminalProps {
  terminal: TerminalClass;
}

export const Terminal = ({ terminal }: TerminalProps): ReactElement => {
  const { name, id } = terminal;
  const { closestTerminal } = useTerminals();

  return (
    <li>
      <Link
        className={clsx(
          "whitespace-nowrap",
          "block cursor-pointer",
          "px-4 py-2",
          "hover:bg-lighten-high",
          "flex items-center",
          "text-lg"
        )}
        to={`/${getSlug(id)}`}
      >
        {id === closestTerminal?.id ? (
          <LocationIcon className="mr-3" />
        ) : (
          <div className="w-4 mr-3" />
        )}
        {name}
      </Link>
    </li>
  );
};

export const Home = (): ReactElement => {
  const { terminals } = useTerminals();
  return (
    <div className="bg-green-dark text-white overflow-y-scroll scrolling-touch">
      <div className="flex flex-col items-center justify-center w-full h-60">
        <img src={logo} className="w-28" />
        <h1 className="text-4xl font-bold">Ferry FYI</h1>
      </div>
      <div className="w-full flex justify-center">
        <ul>
          <li>
            <Link
              className={clsx(
                "whitespace-nowrap",
                "block cursor-pointer",
                "px-4 py-2",
                "hover:bg-lighten-high",
                "flex items-center",
                "text-lg"
              )}
              to={"/tickets"}
            >
              <TicketIcon className="mr-3" />
              Tickets
            </Link>
          </li>
          {terminals.map((terminal) => (
            <Terminal terminal={terminal} key={terminal.id} />
          ))}
        </ul>
      </div>
    </div>
  );
};
