import { isDark } from "../lib/theme";
import { Vessel } from "../../server/lib/vessels";
import clsx from "clsx";
import React, { FunctionComponent } from "react";

interface Props {
  vessel: Vessel;
  isAbbreviation?: boolean;
}

export const VesselTag: FunctionComponent<Props> = (props) => {
  const { isAbbreviation, vessel } = props;
  const { abbreviation, name } = vessel;

  return (
    <div
      className={clsx(
        "font-bold text-2xs",
        isDark ? "bg-gray-medium text-black" : "bg-gray-dark text-white",
        "rounded p-1"
      )}
    >
      <i className="fas fa-ship mr-1" />
      {isAbbreviation ? abbreviation : name}
    </div>
  );
};
