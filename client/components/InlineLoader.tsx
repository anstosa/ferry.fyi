import clsx from "clsx";
import React, { FunctionComponent, PropsWithChildren } from "react";

export const InlineLoader: FunctionComponent<PropsWithChildren> = ({
  children,
}) => (
  <div
    className={clsx(
      "absolute inset-0",
      "bg-blue-lightest dark:bg-gray-darkest text-gray-500",
      "flex justify-center items-center"
    )}
  >
    {children}
  </div>
);
