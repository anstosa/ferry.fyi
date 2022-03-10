import { browserRouter, clientDist } from "./browser";
import compression from "compression";
import express, { Router } from "express";

const staticRouter = Router();

staticRouter.use(compression());
staticRouter.use(express.static(clientDist));
staticRouter.use(browserRouter);

export { staticRouter };
