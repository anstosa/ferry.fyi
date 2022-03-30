import { Bulletin } from "~/models/Bulletin";
import { Router } from "express";

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
