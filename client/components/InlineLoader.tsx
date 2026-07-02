import clsx from "clsx";
import React, { FunctionComponent, PropsWithChildren } from "react";

import { LoadingWaves } from "./LoadingWaves";

// centered internal loader
export const InlineLoader: FunctionComponent<PropsWithChildren> = ({
  children,
}) => (
  <div
    className={clsx(
      "absolute inset-0",
      "bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]",
      "flex flex-col items-center justify-center gap-3 px-6 text-center"
    )}
  >
    <LoadingWaves
      className="h-12 w-32 text-green-dark dark:text-green-light"
      label={typeof children === "string" ? children : "Loading"}
      svgClassName="h-10 w-32"
    />
    {children ? (
      <p className="text-sm font-bold tracking-wide">{children}</p>
    ) : null}
  </div>
);
