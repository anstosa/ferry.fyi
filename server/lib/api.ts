import { Context } from "koa";
import { getWsfStatus } from "./wsf/api";

export const sendResponse = (
  context: Context,
  body: Record<string, any> | null
): void => {
  context.body = {
    wsfStatus: getWsfStatus(),
    body,
  };
};

export const sendNotFound = (context: Context): void => {
  context.status = 404;
};
