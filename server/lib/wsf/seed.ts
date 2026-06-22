import logger from "heroku-logger";
import wsfCore from "shared/data/wsf-core.json";
import { values } from "shared/lib/objects";

import { Camera } from "~/models/Camera";
import { Route } from "~/models/Route";
import { Terminal } from "~/models/Terminal";

import { removedTerminalIds } from "./removedTerminals";

let hasLoadedSeed = false;

// hydrate baseline cache
export const hydrateWsfSeed = (): void => {
  // duplicate seed guard
  if (hasLoadedSeed) {
    return;
  }
  hasLoadedSeed = true;

  // seed cameras
  values(wsfCore.cameras).forEach((data) => {
    const [camera, wasCreated] = Camera.getOrCreate(String(data.id), data);
    // existing camera guard
    if (!wasCreated) {
      camera.update(data);
    }
    camera.save();
  });

  // seed routes
  values(wsfCore.routes).forEach((data) => {
    const [route, wasCreated] = Route.getOrCreate(String(data.id), data);
    // existing route guard
    if (!wasCreated) {
      route.update(data);
    }
    route.save();
  });

  // seed terminals
  values(wsfCore.terminals).forEach((data) => {
    const [terminal, wasCreated] = Terminal.getOrCreate(String(data.id), data);
    // existing terminal guard
    if (!wasCreated) {
      terminal.update(data);
    }
    terminal.save();
  });

  // remove retired terminals
  removedTerminalIds.forEach((terminalId) => {
    Terminal.getByIndex(terminalId)?.purge();
  });

  // connect terminal relations
  values(Terminal.getAll()).forEach((terminal) => {
    terminal.update({
      cameras: Camera.sortByTerminalDisplayOrder(
        Camera.getByTerminalId(terminal.id)
      ),
      mates: Route.getMatesByTerminalId(terminal.id),
      routes: Route.getByTerminalId(terminal.id),
    });
    terminal.save();
  });

  logger.info(
    `Hydrated WSF seed with ${Object.keys(Terminal.getAll()).length} terminals`
  );
};
