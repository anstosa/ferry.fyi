import { Router } from "express";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { entries } from "shared/lib/objects";

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
  if (!terminal) {
    return response.status(404).send();
  }
  return response.send(terminal.serialize());
});

export { terminalRouter };
