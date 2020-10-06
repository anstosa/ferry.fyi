import { Vessel } from "../../server/lib/wsf";
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
        "font-bold text-2xs text-white",
        "bg-gray-dark rounded p-1"
      )}
    >
      <i className="fas fa-ship mr-1" />
      {isAbbreviation ? abbreviation : name}
    </div>
  );
};
