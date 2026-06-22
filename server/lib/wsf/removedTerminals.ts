import { values } from "shared/lib/objects";

import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";

export const removedTerminalIds = ["19"];

// identify retired terminals
export const isRemovedTerminalId = (terminalId: string): boolean =>
  removedTerminalIds.includes(terminalId);

// purge retired terminal data
export const purgeRemovedTerminalData = (): void => {
  // remove retired terminals
  removedTerminalIds.forEach((terminalId) => {
    Terminal.getByIndex(terminalId)?.purge();
  });

  // remove retired routes
  values(Route.getAll()).forEach((route) => {
    // retired route guard
    if (route.terminalIds.some(isRemovedTerminalId)) {
      route.purge();
    }
  });
};
