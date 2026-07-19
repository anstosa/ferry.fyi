import type { FunctionComponent, SVGAttributes } from "react";

import BicycleIcon from "../static/images/icons/solid/bicycle.svg";
import CarIcon from "../static/images/icons/solid/car.svg";
import CarSideIcon from "../static/images/icons/solid/car-side.svg";
import MotorcycleIcon from "../static/images/icons/solid/motorcycle.svg";
import RulerIcon from "../static/images/icons/solid/ruler-combined.svg";
import TruckIcon from "../static/images/icons/solid/truck.svg";
import UndoIcon from "../static/images/icons/solid/undo.svg";
import UserIcon from "../static/images/icons/solid/user.svg";
import WalkingIcon from "../static/images/icons/solid/walking.svg";
import WheelchairIcon from "../static/images/icons/solid/wheelchair.svg";

export type FareWizardIcon = FunctionComponent<SVGAttributes<SVGElement>>;

export const fareWizardIcons = {
  bicycle: BicycleIcon,
  car: CarIcon,
  carSide: CarSideIcon,
  motorcycle: MotorcycleIcon,
  ruler: RulerIcon,
  truck: TruckIcon,
  undo: UndoIcon,
  user: UserIcon,
  walking: WalkingIcon,
  wheelchair: WheelchairIcon,
};
