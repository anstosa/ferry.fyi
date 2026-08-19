import { useEffect, useState } from "react";
import type { WSFStatus } from "shared/contracts/api";
import { isEqual } from "shared/lib/objects";

interface HttpResponse {
  data: unknown;
  status: number;
}

interface HttpRequest {
  data?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
  method: "DELETE" | "GET" | "POST" | "PUT";
  url: string;
  webFetchExtra?: RequestInit;
}

// resolve api origin. Native bridge detection happens inside the post-commit
// request adapter so importing a public view never loads Capacitor.
export function getApiBaseUrl(): string {
  return "/api";
}

const request = async (input: HttpRequest): Promise<HttpResponse> => {
  const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
  const baseUrl = Capacitor.isNativePlatform()
    ? `${process.env.BASE_URL}/api`
    : getApiBaseUrl();
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
  return await CapacitorHttp.request({
    ...input,
    headers,
    url: `${baseUrl}${input.url}`,
  });
};

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
// separate every authenticated read owner
let authenticatedRequestSequence = 0;

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
  // never coalesce reads across authenticated identities
  if (accessToken) {
    authenticatedRequestSequence += 1;
    return `${path}:auth:${authenticatedRequestSequence}`;
  }
  return `${path}:anon`;
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
  const promise = request({
    headers: {
      ...getAuthHeader(accessToken),
    },
    method: "GET",
    url: path,
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
  const response = await request({
    method: "POST",
    url: path,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(accessToken),
    },
    data,
  });
  return await processResponse(response);
};

/** Posts a small best-effort payload that may outlive a page transition. */
export const postKeepalive = async <T = Record<string, unknown>>(
  path: string,
  data: Record<string, unknown>
): Promise<T> => {
  const response = await request({
    data,
    headers: { "Content-Type": "application/json" },
    method: "POST",
    url: path,
    webFetchExtra: { keepalive: true },
  });
  return await processResponse(response);
};

export const put = async <T = Record<string, unknown>>(
  path: string,
  data: Record<string, unknown>,
  accessToken?: string
): Promise<T> => {
  const response = await request({
    method: "PUT",
    url: path,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(accessToken),
    },
    data,
  });
  return await processResponse(response);
};

/** Performs an authenticated API delete without retaining request data. */
export const del = async <T = Record<string, unknown>>(
  path: string,
  data: Record<string, unknown>,
  accessToken?: string
): Promise<T> => {
  const response = await request({
    method: "DELETE",
    url: path,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(accessToken),
    },
    data,
  });
  return await processResponse(response);
};

export const useOnline = (): boolean => {
  // keep the first render anonymous and deterministic
  // after commit so document rendering never reads navigator.
  const [online, setOnline] = useState<boolean>(true);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);
  return online;
};
