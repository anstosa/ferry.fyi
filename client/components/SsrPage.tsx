import clsx from "clsx";
import React, { type PropsWithChildren, type ReactElement } from "react";

/**
 * Server-route page chrome. This deliberately has no lazy Header import: the
 * interactive header owns account and native integrations and must remain in
 * the browser build.
 */
export const SsrPage = ({ children }: PropsWithChildren): ReactElement => (
  <div
    className={clsx(
      "px-4 pb-10",
      "h-full min-h-full overflow-y-auto scrolling-touch",
      "bg-gray-100 text-gray-900 dark:bg-blue-darkest dark:text-gray-300"
    )}
  >
    <main className="mx-auto w-full max-w-6xl">{children}</main>
  </div>
);
