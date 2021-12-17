import { isEqual } from "shared/lib/objects";
import { useEffect, useState } from "react";
import { WSFStatus } from "shared/contracts/api";
const API_BASE_URL = "/api";

let wsfStatus: WSFStatus = { offline: false };

export const useWSF = (): WSFStatus => {
  const [status, setStatus] = useState<WSFStatus>(wsfStatus);
  useEffect(() => {
    setStatus(wsfStatus);
  }, [wsfStatus]);
  return status;
};

const inProgress: Record<string, Promise<any>> = {};

const processResponse = async (response: Response): Promise<any> => {
  const responseData = await response.json();
  if (!isEqual(responseData.wsfStatus, wsfStatus)) {
    ({ wsfStatus } = responseData);
  }
  return responseData.body;
};

export const get = async <T = Record<string, unknown>>(
  path: string
): Promise<T> => {
  if (path in inProgress) {
    return await inProgress[path];
  }
  const promise = fetch(`${API_BASE_URL}${path}`).then(processResponse);
  inProgress[path] = promise;
  return await promise;
};

export const post = async <T = Record<string, unknown>>(
  path: string,
  data: Record<string, unknown>
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return await processResponse(response);
};

export const useOnline = (): boolean => {
  const isOnline = window?.navigator?.onLine ?? true;
  const [online, setOnline] = useState<boolean>(isOnline);
  useEffect(() => {
    setOnline(isOnline);
  }, [isOnline]);
  return online;
};
