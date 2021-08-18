const API_BASE_URL = "/api";

export const get = async <T = Record<string, unknown>>(
  path: string
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`);
  return response.json();
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
  return response.json();
};

export const isOnline = (): boolean => window?.navigator?.onLine ?? true;
