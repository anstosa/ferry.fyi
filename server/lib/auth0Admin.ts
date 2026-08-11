interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}
interface UserResponse {
  email?: unknown;
  email_verified?: unknown;
  identities?: unknown;
  user_id?: unknown;
}
interface UsersResponse {
  total?: unknown;
  users?: unknown;
}

export interface Auth0UserIdentity {
  email?: string;
  emailVerified?: boolean;
  subject: string;
}

export interface Auth0UserProviderIdentity {
  connection: string;
  provider: string;
  userId: string;
}

export interface Auth0UserProfile extends Auth0UserIdentity {
  emailVerified: boolean;
  identities: Auth0UserProviderIdentity[];
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

/** sends an authenticated Auth0 Management API request */
const requestManagementApi = async (
  path: string | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const url =
    typeof path === "string" ? new URL(path, managementAudience()) : path;
  // authenticated request
  const send = async (): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await getManagementToken()}`);
    return fetch(url, { ...init, headers });
  };

  const response = await send();
  // stale permission guard
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }
  token = undefined;
  tokenExpiresAt = 0;
  return send();
};

export const getAuth0UserEmail = async (
  subject: string
): Promise<string | undefined> => {
  const url = new URL(
    `users/${encodeURIComponent(subject)}`,
    managementAudience()
  );
  url.searchParams.set("fields", "email");
  url.searchParams.set("include_fields", "true");
  const response = await requestManagementApi(url);
  if (!response.ok) {
    throw new Error(`Auth0 user lookup failed: ${response.status}`);
  }
  const body = (await response.json()) as UserResponse;
  return typeof body.email === "string" ? body.email : undefined;
};

/** permanently removes a Ferry FYI Auth0 identity */
export const deleteAuth0User = async (subject: string): Promise<void> => {
  const response = await requestManagementApi(
    `users/${encodeURIComponent(subject)}`,
    { method: "DELETE" }
  );
  // idempotent deletion guard
  if (!response.ok && response.status !== 404) {
    throw new Error(`Auth0 user deletion failed: ${response.status}`);
  }
};

/**
 * Resolves the profile attached to an already validated user access token.
 * Tokens requested with `openid` are also valid for Auth0's `/userinfo`
 * audience, so owner authorization does not require Management API access.
 */
export const getAuth0UserInfo = async (
  accessToken: string
): Promise<Auth0UserIdentity> => {
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) {
    throw new Error("Auth0 domain is not configured");
  }
  const response = await fetch(`https://${domain}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Auth0 user info request failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    email?: unknown;
    email_verified?: unknown;
    sub?: unknown;
  };
  if (typeof body.sub !== "string") {
    throw new Error("Auth0 user info subject was missing");
  }
  return {
    ...(typeof body.email === "string" ? { email: body.email } : {}),
    ...(typeof body.email_verified === "boolean"
      ? { emailVerified: body.email_verified }
      : {}),
    subject: body.sub,
  };
};

// provider identity parser
const parseAuth0ProviderIdentities = (
  value: unknown
): Auth0UserProviderIdentity[] => {
  // array guard
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((identity): Auth0UserProviderIdentity[] => {
    // identity shape guard
    if (
      !identity ||
      typeof identity !== "object" ||
      typeof (identity as { connection?: unknown }).connection !== "string" ||
      typeof (identity as { provider?: unknown }).provider !== "string" ||
      typeof (identity as { user_id?: unknown }).user_id !== "string"
    ) {
      return [];
    }
    return [
      {
        connection: (identity as { connection: string }).connection,
        provider: (identity as { provider: string }).provider,
        userId: (identity as { user_id: string }).user_id,
      },
    ];
  });
};

/** Returns the bounded Auth0 fields needed to verify an account migration. */
export const getAuth0UserProfile = async (
  subject: string
): Promise<Auth0UserProfile> => {
  const url = new URL(
    `users/${encodeURIComponent(subject)}`,
    managementAudience()
  );
  url.searchParams.set("fields", "user_id,email,email_verified,identities");
  url.searchParams.set("include_fields", "true");
  const response = await requestManagementApi(url);
  // lookup response guard
  if (!response.ok) {
    throw new Error(`Auth0 user profile lookup failed: ${response.status}`);
  }
  const body = (await response.json()) as UserResponse;
  // subject response guard
  if (typeof body.user_id !== "string" || body.user_id !== subject) {
    throw new Error("Auth0 user profile subject was invalid");
  }
  return {
    ...(typeof body.email === "string" ? { email: body.email } : {}),
    emailVerified: body.email_verified === true,
    identities: parseAuth0ProviderIdentities(body.identities),
    subject: body.user_id,
  };
};

export type Auth0LinkIdentityResult = "already-linked" | "linked";

// identity membership guard
const hasAuth0Identity = (
  profile: Auth0UserProfile,
  identity: Auth0UserProviderIdentity
): boolean =>
  profile.identities.some(
    (candidate) =>
      candidate.provider === identity.provider &&
      candidate.userId === identity.userId
  );

/** Links a verified secondary identity while preserving the primary subject. */
export const linkAuth0UserIdentity = async (
  primarySubject: string,
  secondaryIdentity: Auth0UserProviderIdentity
): Promise<Auth0LinkIdentityResult> => {
  const primary = await getAuth0UserProfile(primarySubject);
  // idempotency guard
  if (hasAuth0Identity(primary, secondaryIdentity)) {
    return "already-linked";
  }
  const response = await requestManagementApi(
    `users/${encodeURIComponent(primarySubject)}/identities`,
    {
      body: JSON.stringify({
        provider: secondaryIdentity.provider,
        user_id: secondaryIdentity.userId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  // success guard
  if (response.ok) {
    return "linked";
  }
  // race recovery
  if (response.status === 400 || response.status === 409) {
    const refreshedPrimary = await getAuth0UserProfile(primarySubject);
    // linked race guard
    if (hasAuth0Identity(refreshedPrimary, secondaryIdentity)) {
      return "already-linked";
    }
  }
  throw new Error(`Auth0 identity link failed: ${response.status}`);
};

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
  const response = await requestManagementApi(url);
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

// exact email lookup boundary
const getAuth0UsersByExactEmail = async (
  email: string
): Promise<UserResponse[]> => {
  const normalized = email.trim().toLocaleLowerCase("en-US");
  // email input guard
  if (!normalized || normalized.length > 320) {
    return [];
  }
  const url = new URL("users-by-email", managementAudience());
  url.searchParams.set("email", email.trim());
  const response = await requestManagementApi(url);
  if (!response.ok) {
    throw new Error(`Auth0 email lookup failed: ${response.status}`);
  }
  const users = (await response.json()) as unknown;
  // response shape guard
  if (!Array.isArray(users)) {
    return [];
  }
  return users.filter(
    (user): user is UserResponse =>
      Boolean(user) &&
      typeof user === "object" &&
      typeof (user as UserResponse).user_id === "string" &&
      typeof (user as UserResponse).email === "string" &&
      ((user as UserResponse).email as string)
        .trim()
        .toLocaleLowerCase("en-US") === normalized
  );
};

/** Exact email lookup, kept server-side and bounded to Auth0's response. */
export const findAuth0UserByExactEmail = async (
  email: string
): Promise<Auth0UserIdentity | undefined> => {
  const users = await getAuth0UsersByExactEmail(email);
  const match = users[0];
  return match
    ? {
        email: match.email as string,
        subject: match.user_id as string,
      }
    : undefined;
};

export type Auth0VerificationEmailResult =
  | "already-verified"
  | "sent"
  | "user-not-found";

/** Requests verification for the matching database identity only. */
export const sendAuth0VerificationEmailForProvider = async ({
  connection,
  email,
  provider,
}: {
  connection: string;
  email: string;
  provider: string;
}): Promise<Auth0VerificationEmailResult> => {
  const users = await getAuth0UsersByExactEmail(email);
  const user = users.find((candidate) =>
    parseAuth0ProviderIdentities(candidate.identities).some(
      (identity) =>
        identity.connection === connection && identity.provider === provider
    )
  );
  // matching identity guard
  if (!user || typeof user.user_id !== "string") {
    return "user-not-found";
  }
  // verified identity guard
  if (user.email_verified === true) {
    return "already-verified";
  }
  const response = await requestManagementApi("jobs/verification-email", {
    body: JSON.stringify({ user_id: user.user_id }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  // job acceptance guard
  if (!response.ok) {
    throw new Error(
      `Auth0 verification email request failed: ${response.status}`
    );
  }
  return "sent";
};

type Auth0RevocationCapability = "complete" | "unavailable";

export interface Auth0RevocationResult {
  /** Device credentials include refresh-token-backed app sessions. */
  deviceCredentials: Auth0RevocationCapability;
  /** Auth0 SSO termination is deliberately not claimed by this application. */
  sessions: Auth0RevocationCapability;
  status: "complete" | "partial";
}

// management get request
const getManagementResponse = (path: string): Promise<Response> =>
  requestManagementApi(path);

// management delete request
const deleteManagementResource = async (path: string): Promise<boolean> => {
  const response = await requestManagementApi(path, {
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
