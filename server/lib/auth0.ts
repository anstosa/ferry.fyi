import { Management, ManagementClient } from "auth0";

if (!process.env.AUTH0_DOMAIN) {
  throw Error("AUTH0_DOMAIN environment variable is not set");
}
if (!process.env.AUTH0_SERVER_ID) {
  throw Error("AUTH0_SERVER_ID environment variable is not set");
}
if (!process.env.AUTH0_SERVER_SECRET) {
  throw Error("AUTH0_SERVER_SECRET environment variable is not set");
}

export type Auth0User = Management.UserResponseSchema;
export type Auth0UserUpdate = Management.UpdateUserRequestContent;

export const auth0 = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_SERVER_ID,
  clientSecret: process.env.AUTH0_SERVER_SECRET,
});
