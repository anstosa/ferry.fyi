import { Header } from "../views/Header";
import clsx from "clsx";
import React, { FunctionComponent, ReactElement } from "react";

export const Page: FunctionComponent = ({ children }): ReactElement => (
  <div
    className={clsx(
      "px-4 pb-10",
      "min-h-full",
      "bg-gray-100 text-gray-900 dark:bg-blue-darkest dark:text-gray-300"
    )}
  >
    <Header>
      <h1 className="font-bold text-2xl">Ferry FYI</h1>
    </Header>
    {children}
  </div>
);
