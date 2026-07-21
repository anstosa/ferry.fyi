import clsx from "clsx";
import React, {
  FunctionComponent,
  PropsWithChildren,
  ReactElement,
} from "react";

import { Header } from "../views/Header";

interface Props {
  contentClassName?: string;
  title?: string;
}

// app page shell
export const Page: FunctionComponent<PropsWithChildren<Props>> = ({
  contentClassName,
  title,
  children,
}): ReactElement => (
  <div
    className={clsx(
      "px-4 pb-10",
      "h-full min-h-full overflow-y-auto scrolling-touch",
      "bg-gray-100 text-gray-900 dark:bg-blue-darkest dark:text-gray-300"
    )}
  >
    <Header>
      <h1 className="font-bold text-2xl">{title ?? "Ferry FYI"}</h1>
    </Header>
    {contentClassName ? (
      <main className={contentClassName}>{children}</main>
    ) : (
      children
    )}
  </div>
);
