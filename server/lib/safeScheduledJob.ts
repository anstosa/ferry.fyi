import logger from "heroku-logger";

import { getErrorMessage, getLogError } from "./errors";

export type ScheduledTask = () => Promise<void> | void;

// nested db error text
const getNestedErrorText = (error: unknown): string => {
  const typedError = error as {
    message?: string;
    name?: string;
    original?: { code?: string; message?: string; name?: string };
    parent?: { code?: string; message?: string; name?: string };
  };
  return [
    typedError.name,
    typedError.message,
    typedError.parent?.name,
    typedError.parent?.message,
    typedError.parent?.code,
    typedError.original?.name,
    typedError.original?.message,
    typedError.original?.code,
  ]
    .filter(Boolean)
    .join(" ");
};

// transient db failure check
export const isTransientDatabaseError = (error: unknown): boolean => {
  const errorText = getNestedErrorText(error);
  return /Sequelize(Connection|ConnectionAcquire|Timeout)Error|Connection terminated unexpectedly|ECONNRESET|ETIMEDOUT|ECONNREFUSED|terminating connection|server closed the connection/i.test(
    errorText
  );
};

// run scheduled work safely
export const runScheduledTask = async (
  name: string,
  task: ScheduledTask
): Promise<void> => {
  try {
    await task();
  } catch (error) {
    const message = getErrorMessage(error);
    const prefix = isTransientDatabaseError(error)
      ? "Transient database error in scheduled job"
      : "Scheduled job failed";
    logger.error(`${prefix} ${name}: ${message}`, getLogError(error));
  }
};

// protect node-schedule callbacks
export const safeScheduledTask = (
  name: string,
  task: ScheduledTask
): (() => void) => {
  return () => {
    runScheduledTask(name, task).catch((error) => {
      // defensive scheduler guard
      logger.error(
        `Scheduled job wrapper failed ${name}: ${getErrorMessage(error)}`,
        getLogError(error)
      );
    });
  };
};
