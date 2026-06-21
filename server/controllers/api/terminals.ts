import { Router } from "express";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { entries } from "shared/lib/objects";

import { getWsfStatus } from "~/lib/wsf/api";
import { Terminal } from "~/models/Terminal";

const terminalRouter = Router();

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
