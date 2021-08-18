import clsx from "clsx";
import React, { ReactElement } from "react";
import ReloadIcon from "~/images/icons/solid/redo.svg";

interface Props {
  ariaLabel: string;
  isReloading: boolean;
  onClick: () => void;
}

export const ReloadButton = ({
  ariaLabel,
  isReloading,
  onClick,
}: Props): ReactElement => (
  <ReloadIcon
    className={clsx(
      "text-xl spin cursor-pointer ml-4",
      !isReloading && "spin-pause"
    )}
    aria-label={ariaLabel}
    onClick={onClick}
  />
);
