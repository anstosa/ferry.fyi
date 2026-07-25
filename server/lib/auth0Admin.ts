interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}
interface UserResponse {
  email?: unknown;
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
