import { Header } from "../views/Header";
import clsx from "clsx";
import React, { FunctionComponent, ReactElement } from "react";

interface Props {
  title?: string;
}

export const Page: FunctionComponent<Props> = ({
  title,
  children,
}): ReactElement => (
  <div
    className={clsx(
      "px-4 pb-10",
      "min-h-full",
      "bg-gray-100 text-gray-900 dark:bg-blue-darkest dark:text-gray-300"
    )}
  >
    <Header>
      <h1 className="font-bold text-2xl">{title ?? "Ferry FYI"}</h1>
    </Header>
    {children}
  </div>
);
