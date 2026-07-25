import clsx from "clsx";
import React, {
  FunctionComponent,
  PropsWithChildren,
  ReactElement,
  ReactNode,
} from "react";

import { Header } from "../views/Header";

interface Props {
  headerAction?: ReactNode;
  title?: string;
}

// app page shell
export const Page: FunctionComponent<PropsWithChildren<Props>> = ({
  headerAction,
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
      <h1 className="min-w-0 flex-1 truncate font-bold text-2xl">
        {title ?? "Ferry FYI"}
      </h1>
      {headerAction && <div className="ml-auto shrink-0">{headerAction}</div>}
    </Header>
    <main className="mx-auto w-full max-w-6xl">{children}</main>
  </div>
);
