import { getWsfStatus } from "./wsf/api";
import { Response } from "express";

export const sendResponse = (
  response: Response,
  body: Record<string, any> | null
): void => {
  response.send({
    wsfStatus: getWsfStatus(),
    body,
  });
};
