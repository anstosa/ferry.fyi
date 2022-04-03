import { getSlug, useTerminals } from "~/lib/terminals";
import { isEmpty } from "shared/lib/arrays";
import { Link } from "react-router-dom";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { Today } from "./Today";
import clsx from "clsx";
import LocationIcon from "~/static/images/icons/solid/location.svg";
import logo from "~/static/images/icon_monochrome.png";
import React, { ReactElement } from "react";
import TicketIcon from "~/static/images/icons/solid/barcode-alt.svg";

interface TerminalProps {
  terminal: TerminalClass;
}

const LI_CLASSES = clsx(
  "whitespace-nowrap",
  "block cursor-pointer",
  "px-4 py-2",
  "hover:bg-lighten-high",
  "flex items-center justify-center",
  "text-lg"
);

export const Terminal = ({ terminal }: TerminalProps): ReactElement => {
  const { name, id } = terminal;
  const { closestTerminal } = useTerminals();

  return (
    <li>
      <Link
        className={clsx(LI_CLASSES, {
          "font-bold": id === closestTerminal?.id,
        })}
        to={`/${getSlug(id)}`}
      >
        {id === closestTerminal?.id && <LocationIcon className="mr-3" />}
        {name}
      </Link>
    </li>
  );
};

export const Home = (): ReactElement => {
  if (location.host === "howmanyboats.today") {
    return <Today />;
  }
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
                LI_CLASSES,
                "font-bold",
                "border-b border-b-1 border-white border-opacity-20"
              )}
              to={"/tickets"}
            >
              <TicketIcon className="mr-3" />
              Tickets
            </Link>
          </li>
          {isEmpty(terminals) && (
            <li className={clsx(LI_CLASSES, "opacity-50")}>
              Loading terminals...
            </li>
          )}
          {terminals.map((terminal) => (
            <Terminal terminal={terminal} key={terminal.id} />
          ))}
        </ul>
      </div>
    </div>
  );
};
