import { NextFunction, Request, Response, Router } from "express";

const DISABLED_ENV_PATTERN = /^(0|false|no|off)$/i;
const ENABLED_ENV_PATTERN = /^(1|true|yes|on)$/i;
const WEB_PROCESS_ROLE = "web";

// normalize optional env flag
function readEnvFlag(value: string | undefined): boolean | undefined {
  // missing flag guard
  if (value === undefined) {
    return undefined;
  }
  // disabled flag guard
  if (DISABLED_ENV_PATTERN.test(value)) {
    return false;
  }
  // enabled flag guard
  if (ENABLED_ENV_PATTERN.test(value)) {
    return true;
  }
  return undefined;
}

// decide scheduler ownership
export function shouldRunScheduler(): boolean {
  const schedulerFlag = readEnvFlag(process.env.RUN_SCHEDULER);
  // explicit flag guard
  if (schedulerFlag !== undefined) {
    return schedulerFlag;
  }
  const processRole = process.env.PROCESS_ROLE?.toLowerCase();
  // web role guard
  if (processRole === WEB_PROCESS_ROLE) {
    return false;
  }
  return true;
}

export const healthRouter = Router();

// health check route
healthRouter.get("/healthz", (_request, response) => {
  response.status(200).type("text/plain").send("ok");
});

// redirect insecure app traffic
export function forceHttps(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const protocol = request.get("x-forwarded-proto") || request.protocol;
  // https redirect guard
  if (protocol !== "https") {
    response.redirect(
      301,
      `https://${request.get("host")}${request.originalUrl}`
    );
    return;
  }
  next();
}
