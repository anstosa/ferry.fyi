import { Router } from "express";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { entries } from "shared/lib/objects";

import { getWsfStatus } from "~/lib/wsf/api";
import { Terminal } from "~/models/Terminal";
import {
  getBulletinSourceUpdatedAt,
  updateTerminals,
} from "~/lib/wsf/updateTerminals";

const terminalRouter = Router();
let bulletinRefresh: Promise<void> | null = null;

terminalRouter.get("/bulletins/freshness", (request, response) =>
  response.send({ sourceUpdatedAt: getBulletinSourceUpdatedAt() })
);

terminalRouter.post("/bulletins/refresh", async (request, response) => {
  const now = Date.now() / 1000;
  const sourceUpdatedAt = getBulletinSourceUpdatedAt();
  if (sourceUpdatedAt === null || now - sourceUpdatedAt > 60) {
    if (!bulletinRefresh) {
      bulletinRefresh = updateTerminals({ forceBulletins: true })
        .then((didFetchBulletins) => {
          if (!didFetchBulletins) {
            return;
          }
        })
        .finally(() => {
          bulletinRefresh = null;
        });
    }
    try {
      await bulletinRefresh;
    } catch {
      return response.status(502).send({ error: "Unable to refresh bulletins" });
    }
  }
  return response.send({ sourceUpdatedAt: getBulletinSourceUpdatedAt() });
});

terminalRouter.get("/", async (request, response) => {
  const terminals = await Terminal.getAll();
  const results: Record<string, TerminalClass> = {};
  entries(terminals).forEach(([key, terminal]) => {
    results[key] = terminal.serialize();
  });
  return response.send(results);
});

terminalRouter.get("/:terminalId", async (request, response) => {
  const { terminalId } = request.params;
  const terminal = await Terminal.getByIndex(terminalId);
  // terminal found guard
  if (terminal) {
    return response.send(terminal.serialize());
  }
  // warming guard
  if (!getWsfStatus().coreReady) {
    return response.status(503).send({ status: "warming" });
  }
  return response.status(404).send();
});

export { terminalRouter };
