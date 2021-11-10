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

export const get = async <T = Record<string, unknown>>(
  path: string
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const responseData = await response.json();
  if (!isEqual(responseData.wsfStatus, wsfStatus)) {
    ({ wsfStatus } = responseData);
  }
  return responseData.body;
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
  const responseData = await response.json();
  if (!isEqual(data.wsfStatus, wsfStatus)) {
    ({ wsfStatus } = responseData);
  }
  return responseData.body;
};

export const useOnline = (): boolean => {
  const isOnline = window?.navigator?.onLine ?? true;
  const [online, setOnline] = useState<boolean>(isOnline);
  useEffect(() => {
    setOnline(isOnline);
  }, [isOnline]);
  return online;
};
