import clsx from "clsx";
import React, { type PropsWithChildren, type ReactElement } from "react";

// own route-page insets once while keeping native anchor scrolling animated
export const SsrPage = ({
  children,
  routePage = false,
}: PropsWithChildren<{ routePage?: boolean }>): ReactElement => (
  <div
    className={clsx(
      routePage ? "pb-10" : "px-4 pb-10",
      "h-full min-h-full overflow-y-auto scrolling-touch motion-safe:scroll-smooth",
      "bg-gray-100 text-gray-900 dark:bg-blue-darkest dark:text-gray-300"
    )}
  >
    <main className={clsx("mx-auto w-full max-w-6xl", routePage && "p-4")}>
      {children}
    </main>
  </div>
);
