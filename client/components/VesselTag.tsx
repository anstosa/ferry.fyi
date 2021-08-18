import { isDark } from "~/lib/theme";
import clsx from "clsx";
import React, { ReactElement } from "react";
import ShipIcon from "~/images/icons/solid/ship.svg";
import type { Vessel } from "shared/models/vessels";

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
        isDark ? "bg-gray-medium text-black" : "bg-gray-dark text-white",
        "rounded p-1"
      )}
    >
      <ShipIcon className="inline-block mr-1" />
      {isAbbreviation ? abbreviation : name}
    </div>
  );
};
