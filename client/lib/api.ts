import { CapacitorHttp, HttpResponse } from "@capacitor/core";
import { useEffect, useState } from "react";
import type { WSFStatus } from "shared/contracts/api";
import { isEqual } from "shared/lib/objects";

const API_BASE_URL = `${process.env.BASE_URL}/api`;

const defaultWsfStatus: WSFStatus = { offline: false };

let wsfStatus: WSFStatus = defaultWsfStatus;

// wsf status validator
const isWSFStatus = (value: unknown): value is WSFStatus =>
  Boolean(
    value &&
    typeof value === "object" &&
    "offline" in value &&
    typeof value.offline === "boolean"
  );

export const useWSF = (): WSFStatus => {
  const [status, setStatus] = useState<WSFStatus>(wsfStatus);
  useEffect(() => {
    setStatus(wsfStatus);
  }, [wsfStatus]);
  return status;
};

const inProgress: Record<string, Promise<any>> = {};

export class ApiError extends Error {
  status: number;
  data: unknown;

  // api error details
  constructor(status: number, data: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// request cache key
const getRequestKey = (path: string, accessToken?: string): string => {
  return `${path}:${accessToken ? "auth" : "anon"}`;
};

// parse response data
const getResponseData = (data: unknown): unknown => {
  // json string guard
  if (typeof data !== "string") {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

export const processResponse = (response: HttpResponse): any => {
  const responseData = getResponseData(response.data);
  // http error guard
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(response.status, responseData);
  }
  // api envelope guard
  // object response guard
  if (responseData && typeof responseData === "object") {
    const nextWsfStatus = (responseData as { wsfStatus?: unknown }).wsfStatus;
    // status envelope guard
    if (isWSFStatus(nextWsfStatus) && !isEqual(nextWsfStatus, wsfStatus)) {
      wsfStatus = nextWsfStatus;
    }
  }
  // legacy body guard
  if (
    responseData &&
    typeof responseData === "object" &&
    "body" in responseData
  ) {
    return responseData.body;
  }
  return responseData;
};

const getAuthHeader = (accessToken?: string): { Authorization?: string } => {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
};

export const get = async <T = Record<string, unknown>>(
  path: string,
  accessToken?: string
): Promise<T> => {
  const requestKey = getRequestKey(path, accessToken);
  // in-flight guard
  if (requestKey in inProgress) {
    return await inProgress[requestKey];
  }
  const promise = CapacitorHttp.request({
    headers: {
      ...getAuthHeader(accessToken),
    },
    method: "GET",
    url: `${API_BASE_URL}${path}`,
  }).then(processResponse);
  // eslint-disable-next-line require-atomic-updates
  inProgress[requestKey] = promise;
  try {
    return await promise;
  } finally {
    delete inProgress[requestKey];
  }
};

export const post = async <T = Record<string, unknown>>(
  path: string,
  data: Record<string, unknown>,
  accessToken?: string
): Promise<T> => {
  const response = await CapacitorHttp.request({
    method: "POST",
    url: `${API_BASE_URL}${path}`,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(accessToken),
    },
    data,
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
