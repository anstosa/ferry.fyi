import { AUTH0_DATABASE_CONNECTION } from "shared/contracts/iosMigration";

type Auth0DatabaseSignupResult = "created" | "exists";

class Auth0DatabaseSignupError extends Error {
  status: number;

  // signup error
  constructor(status: number) {
    super(`Auth0 database signup failed with status ${status}`);
    this.name = "Auth0DatabaseSignupError";
    this.status = status;
  }
}

/** Creates the secondary database identity without sending its password to Ferry FYI. */
export const createAuth0DatabaseAccount = async ({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<Auth0DatabaseSignupResult> => {
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  // client configuration guard
  if (!domain || !clientId) {
    throw new Error("Auth0 environment variables are not set");
  }
  const response = await fetch(`https://${domain}/dbconnections/signup`, {
    body: JSON.stringify({
      client_id: clientId,
      connection: AUTH0_DATABASE_CONNECTION,
      email,
      password,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  // created guard
  if (response.ok) {
    return "created";
  }
  // existing database identity guard
  if (response.status === 409) {
    return "exists";
  }
  throw new Auth0DatabaseSignupError(response.status);
};

/** Opens the web client because the dedicated iOS Auth0 client has no Google connection. */
export const openWebIosMigration = async (url: string): Promise<void> => {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
};
