import { Router } from "express";

import { Bulletin } from "~/models/Bulletin";

const debugRouter = Router();

debugRouter.post("/alert", async (request, response) => {
  const data = request.body;
  const [bulletin] = await Bulletin.getOrCreate(
    Bulletin.generateIndex(data),
    data
  );
  return response.send(bulletin.serialize());
});

export { debugRouter };
