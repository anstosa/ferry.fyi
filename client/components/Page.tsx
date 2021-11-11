import { Header } from "./Header/index";
import clsx from "clsx";
import React, { FunctionComponent, ReactElement } from "react";
import ShipIcon from "~/images/icons/solid/ship.svg";

export const Page: FunctionComponent = ({ children }): ReactElement => (
  <div
    className={clsx(
      "px-4 pb-10",
      "min-h-full",
      "bg-gray-100 text-gray-900 dark:bg-blue-darkest dark:text-gray-300"
    )}
  >
    <Header>
      <h1 className="font-bold text-2xl">
        <ShipIcon className="inline-block mr-4" />
        Ferry FYI
      </h1>
    </Header>
    {children}
  </div>
);
