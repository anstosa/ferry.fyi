import { getSlug, useTerminals } from "~/lib/terminals";
import { Link } from "react-router-dom";
import clsx from "clsx";
import LocationIcon from "~/images/icons/solid/location.svg";
import logo from "~/images/icon_monochrome.png";
import React, { ReactElement } from "react";

export const Home = (): ReactElement => {
  const { terminals, closestTerminal } = useTerminals();
  return (
    <div className="bg-green-dark text-white overflow-y-scroll scrolling-touch">
      <div className="flex flex-col items-center justify-center w-full h-60">
        <img src={logo} className="w-28" />
        <h1 className="text-4xl font-bold">Ferry FYI</h1>
      </div>
      <div className="w-full flex justify-center">
        <ul>
          {terminals.map(({ id, name }) => (
            <li key={id}>
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
          ))}
        </ul>
      </div>
    </div>
  );
};