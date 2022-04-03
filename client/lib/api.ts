import { Http, HttpResponse } from "@capacitor-community/http";
import { isEqual } from "shared/lib/objects";
import { useEffect, useState } from "react";
import { WSFStatus } from "shared/contracts/api";

const API_BASE_URL = `${process.env.BASE_URL}/api`;

let wsfStatus: WSFStatus = { offline: false };

export const useWSF = (): WSFStatus => {
  const [status, setStatus] = useState<WSFStatus>(wsfStatus);
  useEffect(() => {
    setStatus(wsfStatus);
  }, [wsfStatus]);
  return status;
};

const inProgress: Record<string, Promise<any>> = {};

const processResponse = ({ data }: HttpResponse): any => {
  if (data.wsfStatus && !isEqual(data.wsfStatus, wsfStatus)) {
    ({ wsfStatus } = data);
  }
  return data.body;
};

const getAuthHeader = (accessToken?: string): { Authorization?: string } => {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
};

export const get = async <T = Record<string, unknown>>(
  path: string,
  accessToken?: string
): Promise<T> => {
  if (path in inProgress) {
    return await inProgress[path];
  }
  const promise = Http.request({
    headers: {
      ...getAuthHeader(accessToken),
    },
    method: "GET",
    url: `${API_BASE_URL}${path}`,
  }).then(processResponse);
  // eslint-disable-next-line require-atomic-updates
  inProgress[path] = promise;
  const result = await promise;
  delete inProgress[path];
  return result;
};

export const post = async <T = Record<string, unknown>>(
  path: string,
  data: Record<string, unknown>,
  accessToken?: string
): Promise<T> => {
  const response = await Http.request({
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
