import { Response } from "express";

import { getWsfStatus } from "./wsf/api";

export const sendResponse = (
  response: Response,
  body: Record<string, any> | null
): void => {
  response.send({
    wsfStatus: getWsfStatus(),
    body,
  });
};
