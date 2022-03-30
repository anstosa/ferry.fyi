import { WSFStatus } from "shared/contracts/api";
import fetch from "node-fetch";
import logger from "heroku-logger";

const API_ACCESS = `?apiaccesscode=${process.env.WSDOT_API_KEY}`;

const wsfStatus: WSFStatus = {
  offline: false,
};

export const getWsfStatus = (): WSFStatus => wsfStatus;

export const wsfRequest = async <T>(path: string): Promise<T | undefined> => {
  const url = `${path}${path.includes("cacheflushdate") ? "" : API_ACCESS}`;
  // logger.debug(`WSF request <${url}>`);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (response.ok) {
      wsfStatus.offline = false;
      const json = (await response.json()) as T;
      return json;
    } else {
      wsfStatus.offline = true;
      logger.error(
        `WSF request error ${
          response.status
        } <${url}>: ${await response.text()}`,
        response
      );
      return;
    }
  } catch (error: any) {
    logger.error(`WSF request error <${url}>: ${error.message}`, error);
  }
};
