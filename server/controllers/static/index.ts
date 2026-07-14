import compression from "compression";
import express, { Router } from "express";

import { browserRouter, clientDist, createBrowserRouter } from "./browser";

export const createStaticRouter = (dist = clientDist): Router => {
  const staticRouter = Router();

  staticRouter.use(compression());
  staticRouter.use(express.static(dist, { index: false }));
  staticRouter.use(
    dist === clientDist ? browserRouter : createBrowserRouter(dist)
  );

  return staticRouter;
};

export const staticRouter = createStaticRouter();
