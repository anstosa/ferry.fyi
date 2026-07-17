import logger from "heroku-logger";
import { WSFStatus } from "shared/contracts/api";

const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;
const DEFAULT_TIMEOUT_MS =
  process.env.NODE_ENV === "development" ? 5000 : 10000;
const REQUEST_TIMEOUT_MS = Number(
  process.env.WSF_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
);
const WSF_API_HOST = "www.wsdot.wa.gov";
const WSF_API_ORIGIN = `https://${WSF_API_HOST}`;

const wsfStatus: WSFStatus = {
  coreReady: false,
  offline: false,
  warming: true,
};

// redact request credentials
const getLoggedUrl = (url: string): string =>
  url.replace(/apiaccesscode=[^&]+/i, "apiaccesscode=[redacted]");

export const getWsfStatus = (): WSFStatus => wsfStatus;

// set core readiness
export const setWsfCoreReady = (isReady: boolean): void => {
  wsfStatus.coreReady = isReady;
};

// set warmup status
export const setWsfWarming = (isWarming: boolean): void => {
  wsfStatus.warming = isWarming;
};

export const wsfRequest = async <T>(path: string): Promise<T | undefined> => {
  const requestedUrl = new URL(
    `${path}${path.includes("cacheflushdate") ? "" : API_ACCESS}`
  );
  if (
    requestedUrl.protocol !== "https:" ||
    requestedUrl.hostname !== WSF_API_HOST
  ) {
    throw new Error(
      `Refused request to non-WSF URL: ${getLoggedUrl(requestedUrl.toString())}`
    );
  }
  // The fixed origin cannot be changed by the caller: URL.pathname always
  // starts with a slash, so it cannot introduce a new authority component.
  const requestUrl = `${WSF_API_ORIGIN}${requestedUrl.pathname}${requestedUrl.search}`;
  const loggedUrl = getLoggedUrl(requestUrl);
  // logger.debug(`WSF request <${loggedUrl}>`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    // successful response guard
    if (response.ok) {
      wsfStatus.offline = false;
      const json = (await response.json()) as T;
      return json;
    }
    wsfStatus.offline = true;
    logger.error(
      `WSF request error ${response.status} <${loggedUrl}>: ${await response.text()}`,
      response
    );
  } catch (error: any) {
    wsfStatus.offline = true;
    // timeout error guard
    if (error.name === "AbortError") {
      logger.error(
        `WSF request timeout <${loggedUrl}> after ${REQUEST_TIMEOUT_MS}ms`
      );
      return;
    }
    logger.error(`WSF request error <${loggedUrl}>: ${error.message}`, error);
  } finally {
    clearTimeout(timeout);
  }
};
