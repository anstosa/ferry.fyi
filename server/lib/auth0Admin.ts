interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}
interface UserResponse {
  email?: unknown;
  user_id?: unknown;
}
interface UsersResponse {
  total?: unknown;
  users?: unknown;
}

let token: string | undefined;
let tokenExpiresAt = 0;

const managementAudience = (): string =>
  `https://${process.env.AUTH0_DOMAIN}/api/v2/`;

const getManagementToken = async (): Promise<string> => {
  if (token && Date.now() < tokenExpiresAt) {
    return token;
  }
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_SERVER_ID;
  const clientSecret = process.env.AUTH0_SERVER_SECRET;
  if (!domain || !clientId || !clientSecret) {
    throw new Error("Auth0 server credentials are not configured");
  }
  const response = await fetch(`https://${domain}/oauth/token`, {
    body: JSON.stringify({
      audience: managementAudience(),
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Auth0 management token request failed: ${response.status}`
    );
  }
  const body = (await response.json()) as TokenResponse;
  if (typeof body.access_token !== "string") {
    throw new Error("Auth0 management token was missing");
  }
  // eslint-disable-next-line require-atomic-updates
  token = body.access_token;
  // eslint-disable-next-line require-atomic-updates
  tokenExpiresAt =
    Date.now() +
    (typeof body.expires_in === "number" ? body.expires_in * 1000 : 300_000) -
    30_000;
  return token;
};

export const getAuth0UserEmail = async (
  subject: string
): Promise<string | undefined> => {
  const accessToken = await getManagementToken();
  const url = new URL(
    `users/${encodeURIComponent(subject)}`,
    managementAudience()
  );
  url.searchParams.set("fields", "email");
  url.searchParams.set("include_fields", "true");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Auth0 user lookup failed: ${response.status}`);
  }
  const body = (await response.json()) as UserResponse;
  return typeof body.email === "string" ? body.email : undefined;
};

export interface Auth0UserIdentity {
  email?: string;
  subject: string;
}

export interface Auth0UserPage {
  items: Auth0UserIdentity[];
  page: number;
  pageSize: number;
  total: number;
}

const escapeAuth0SearchTerm = (value: string): string =>
  value.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");

/**
 * Returns a bounded page of Auth0 identities for the owner-only directory.
 * Search is sent as a parameterized Management API query; raw Auth0 metadata
 * and user profiles are intentionally excluded.
 */
export const listAuth0Users = async ({
  page,
  pageSize,
  query,
}: {
  page: number;
  pageSize: number;
  query?: string;
}): Promise<Auth0UserPage> => {
  const url = new URL("users", managementAudience());
  url.searchParams.set("fields", "user_id,email");
  url.searchParams.set("include_fields", "true");
  url.searchParams.set("include_totals", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(pageSize));
  if (query?.trim()) {
    const term = escapeAuth0SearchTerm(query.trim());
    url.searchParams.set("q", `email:*${term}* OR user_id:*${term}*`);
    url.searchParams.set("search_engine", "v3");
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getManagementToken()}` },
  });
  if (!response.ok) {
    throw new Error(`Auth0 user listing failed: ${response.status}`);
  }
  const body = (await response.json()) as UsersResponse;
  const users = Array.isArray(body.users) ? body.users : [];
  const items = users.flatMap((user): Auth0UserIdentity[] => {
    if (
      !user ||
      typeof user !== "object" ||
      typeof (user as UserResponse).user_id !== "string"
    ) {
      return [];
    }
    const { email } = user as UserResponse;
    return [
      {
        ...(typeof email === "string" ? { email } : {}),
        subject: (user as UserResponse).user_id as string,
      },
    ];
  });
  return {
    items,
    page,
    pageSize,
    total: typeof body.total === "number" ? body.total : items.length,
  };
};

/** Exact email lookup, kept server-side and bounded to Auth0's response. */
export const findAuth0UserByExactEmail = async (
  email: string
): Promise<Auth0UserIdentity | undefined> => {
  const normalized = email.trim().toLocaleLowerCase("en-US");
  if (!normalized || normalized.length > 320) {
    return undefined;
  }
  const url = new URL("users-by-email", managementAudience());
  url.searchParams.set("email", email.trim());
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getManagementToken()}` },
  });
  if (!response.ok) {
    throw new Error(`Auth0 email lookup failed: ${response.status}`);
  }
  const users = (await response.json()) as unknown;
  if (!Array.isArray(users)) {
    return undefined;
  }
  const match = users.find(
    (user): user is UserResponse =>
      Boolean(user) &&
      typeof user === "object" &&
      typeof (user as UserResponse).user_id === "string" &&
      typeof (user as UserResponse).email === "string" &&
      ((user as UserResponse).email as string)
        .trim()
        .toLocaleLowerCase("en-US") === normalized
  );
  return match
    ? {
        email: match.email as string,
        subject: match.user_id as string,
      }
    : undefined;
};

type Auth0RevocationCapability = "complete" | "unavailable";

export interface Auth0RevocationResult {
  /** Device credentials include refresh-token-backed app sessions. */
  deviceCredentials: Auth0RevocationCapability;
  /** Auth0 SSO termination is deliberately not claimed by this application. */
  sessions: Auth0RevocationCapability;
  status: "complete" | "partial";
}

const getManagementResponse = async (path: string): Promise<Response> =>
  fetch(new URL(path, managementAudience()), {
    headers: { Authorization: `Bearer ${await getManagementToken()}` },
  });

const deleteManagementResource = async (path: string): Promise<boolean> => {
  const response = await fetch(new URL(path, managementAudience()), {
    headers: { Authorization: `Bearer ${await getManagementToken()}` },
    method: "DELETE",
  });
  return response.ok;
};

const revokeResourceCollection = async (
  listPath: string,
  itemPath: (id: string) => string
): Promise<Auth0RevocationCapability> => {
  try {
    const response = await getManagementResponse(listPath);
    // Missing scope, tenant entitlement, or unsupported endpoint: the caller
    // must report a truthful partial result rather than implying Auth0 logout.
    if (!response.ok) {
      return "unavailable";
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      return "unavailable";
    }
    const ids = body
      .map((item) =>
        item && typeof item === "object"
          ? (item as { id?: unknown }).id
          : undefined
      )
      .filter((id): id is string => typeof id === "string");
    const deleted = await Promise.all(
      ids.map((id) => deleteManagementResource(itemPath(id)))
    );
    return deleted.every(Boolean) ? "complete" : "unavailable";
  } catch {
    return "unavailable";
  }
};

/**
 * Best-effort Auth0 revocation using only Management API endpoints. Session
 * deletion is capability-dependent and never represents termination of Auth0
 * SSO; application JWT invalidation is handled separately by this service.
 */
export const revokeAuth0UserCredentials = async (
  subject: string
): Promise<Auth0RevocationResult> => {
  const encodedSubject = encodeURIComponent(subject);
  const deviceCredentials = await revokeResourceCollection(
    `device-credentials?user_id=${encodedSubject}`,
    (id) => `device-credentials/${encodeURIComponent(id)}`
  );
  const sessions = await revokeResourceCollection(
    `users/${encodedSubject}/sessions`,
    (id) => `sessions/${encodeURIComponent(id)}`
  );
  return {
    deviceCredentials,
    sessions,
    status:
      deviceCredentials === "complete" && sessions === "complete"
        ? "complete"
        : "partial",
  };
};
