import { ManagementClient } from "auth0";

if (!process.env.AUTH0_DOMAIN) {
  throw Error("AUTH0_DOMAIN environment variable is not set");
}
if (!process.env.AUTH0_SERVER_ID) {
  throw Error("AUTH0_SERVER_ID environment variable is not set");
}
if (!process.env.AUTH0_SERVER_SECRET) {
  throw Error("AUTH0_SERVER_SECRET environment variable is not set");
}

export const auth0 = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_SERVER_ID,
  clientSecret: process.env.AUTH0_SERVER_SECRET,
  scope: [
    "read:users",
    "update:users",
    "create:users_app_metadata",
    "read:users_app_metadata",
    "update:users_app_metadata",
    "delete:users_app_metadata",
  ].join(" "),
});
