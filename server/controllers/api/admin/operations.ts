import { Request, Response, Router } from "express";

import type { AdminOperationName } from "~/lib/admin/operations";

import { requireTypedConfirmation } from "./confirmation";

export const adminOperationsRouter = Router();
type OperationParams = { operation: string };

adminOperationsRouter.get(
  "/",
  async (_request: Request, response: Response) => {
    const { getAdminOperationStates } = await import("~/lib/admin/operations");
    response.send({ operations: await getAdminOperationStates() });
  }
);

const operationFromRequest = async (
  request: Request<OperationParams>
): Promise<AdminOperationName | undefined> => {
  const { operation } = request.params;
  const { isAdminOperationName } = await import("~/lib/admin/operations");
  return isAdminOperationName(operation) ? operation : undefined;
};

adminOperationsRouter.post<OperationParams>(
  "/:operation/run",
  async (request, response, next) => {
    const operation = await operationFromRequest(request);
    if (!operation) {
      response.status(404).send({ error: "Unknown admin operation" });
      return;
    }
    const { isDestructiveAdminOperation } =
      await import("~/lib/admin/operations");
    return requireTypedConfirmation<OperationParams>({
      action: isDestructiveAdminOperation(operation)
        ? "clear-cache"
        : "run-operation",
      getTarget: () => `operation:${operation}`,
    })(request, response, next);
  },
  async (request: Request<OperationParams>, response: Response) => {
    const operation = await operationFromRequest(request);
    if (!operation) {
      response.status(404).send({ error: "Unknown admin operation" });
      return;
    }
    const { runAdminOperation } = await import("~/lib/admin/operations");
    const result = await runAdminOperation(operation);
    response.status(result.started ? 200 : 409).send(result);
  }
);
