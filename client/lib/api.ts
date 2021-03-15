const API_BASE_URL = "/api";

export const get = async (path: string): Promise<Record<string, unknown>> => {
  const response = await fetch(`${API_BASE_URL}${path}`);
  return response.json();
};

export const post = async (
  path: string,
  data: Record<string, unknown>
): Promise<any> => {
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
