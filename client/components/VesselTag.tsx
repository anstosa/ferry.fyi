import clsx from "clsx";
import React, { ReactElement } from "react";
import ShipIcon from "~/static/images/icons/solid/ship.svg";
import type { Vessel } from "shared/contracts/vessels";

interface Props {
  vessel: Vessel;
  isAbbreviation?: boolean;
}

export const VesselTag = ({ isAbbreviation, vessel }: Props): ReactElement => {
  const { abbreviation, name } = vessel;

  return (
    <div
      className={clsx(
        "font-bold text-2xs",
        "bg-gray-dark text-white",
        "dark:bg-gray-medium dark:text-black",
        "rounded p-1"
      )}
    >
      <ShipIcon className="inline-block mr-1" />
      {isAbbreviation ? abbreviation : name}
    </div>
  );
};
