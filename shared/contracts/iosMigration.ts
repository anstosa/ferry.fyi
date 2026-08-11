export const AUTH0_DATABASE_CONNECTION = "Username-Password-Authentication";
export const AUTH0_GOOGLE_CONNECTION = "google-oauth2";

export type IosMigrationState = "complete" | "eligible" | "unsupported";

export type IosMigrationStatus =
  | { state: "unsupported" }
  | { email: string; state: Exclude<IosMigrationState, "unsupported"> };

export interface IosMigrationLinkRequest {
  secondaryAccessToken: string;
}

export interface IosMigrationLinkResponse {
  status: "already-linked" | "linked";
}

export interface IosMigrationVerificationEmailResponse {
  status: "already-verified" | "sent";
}

// link request validator
export const isIosMigrationLinkRequest = (
  value: unknown
): value is IosMigrationLinkRequest => {
  // object guard
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === "secondaryAccessToken" &&
    typeof (value as { secondaryAccessToken?: unknown })
      .secondaryAccessToken === "string" &&
    (value as { secondaryAccessToken: string }).secondaryAccessToken.length >
      0 &&
    (value as { secondaryAccessToken: string }).secondaryAccessToken.length <=
      16_384
  );
};
