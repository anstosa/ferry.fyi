// required authentication domain
const getAuth0Domain = (): string => {
  const domain = process.env.AUTH0_DOMAIN;
  // missing domain guard
  if (!domain) {
    throw new Error("AUTH0_DOMAIN environment variable is not set");
  }
  return domain;
};

// normalized issuer url
const getIssuerUrl = (domain: string): string => `https://${domain}/`;

/** returns the canonical Auth0 Management API audience */
export const getAuth0ManagementAudience = (): string =>
  process.env.AUTH0_SERVER_AUDIENCE ?? `https://${getAuth0Domain()}/api/v2/`;

/** returns the canonical tenant domain for server credentials */
export const getAuth0ManagementDomain = (): string =>
  new URL(getAuth0ManagementAudience()).hostname;

/** returns branded and canonical issuers during migration */
export const getAuth0IssuerUrls = (): string[] => {
  const configuredIssuer = getIssuerUrl(getAuth0Domain());
  const managementIssuer = `${new URL(getAuth0ManagementAudience()).origin}/`;
  return [...new Set([configuredIssuer, managementIssuer])];
};

// decoded token issuer
const getTokenIssuer = (accessToken: string): string | undefined => {
  try {
    const encodedPayload = accessToken.split(".")[1];
    // jwt shape guard
    if (!encodedPayload) {
      return undefined;
    }
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as { iss?: unknown };
    return typeof payload.iss === "string" ? payload.iss : undefined;
  } catch {
    return undefined;
  }
};

/** selects a trusted user-info domain for a validated token */
export const getAuth0UserInfoDomain = (accessToken: string): string => {
  const tokenIssuer = getTokenIssuer(accessToken);
  // trusted issuer match
  const allowedIssuer = getAuth0IssuerUrls().find(
    (issuer) => issuer === tokenIssuer
  );
  return allowedIssuer ? new URL(allowedIssuer).hostname : getAuth0Domain();
};
