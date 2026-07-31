import { Router } from "express";

import {
  getPublicBulletinFreshness,
  refreshPublicBulletins,
} from "~/services/public/bulletins";
import {
  getPublicTerminal,
  getPublicTerminals,
} from "~/services/public/terminals";

const terminalRouter = Router();
let bulletinRefresh: Promise<void> | null = null;

terminalRouter.get("/bulletins/freshness", (request, response) =>
  response.send(getPublicBulletinFreshness())
);

terminalRouter.post("/bulletins/refresh", async (request, response) => {
  const now = Date.now() / 1000;
  const { sourceUpdatedAt } = getPublicBulletinFreshness();
  if (sourceUpdatedAt === null || now - sourceUpdatedAt > 60) {
    if (!bulletinRefresh) {
      bulletinRefresh = refreshPublicBulletins()
        .then(() => undefined)
        .finally(() => {
          bulletinRefresh = null;
        });
    }
    try {
      await bulletinRefresh;
    } catch {
      return response
        .status(502)
        .send({ error: "Unable to refresh bulletins" });
    }
  }
  return response.send(getPublicBulletinFreshness());
});

terminalRouter.get("/", async (request, response) => {
  return response.send(await getPublicTerminals());
});

terminalRouter.get("/:terminalId", async (request, response) => {
  const { terminalId } = request.params;
  const result = await getPublicTerminal(terminalId);
  if (result.status === "available") {
    return response.send(result.terminal);
  }
  if (result.status === "warming") {
    return response.status(503).send({ status: result.status });
  }
  return response.status(404).send();
});

export { terminalRouter };
