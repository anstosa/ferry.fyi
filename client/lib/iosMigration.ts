import { AUTH0_DATABASE_CONNECTION } from "shared/contracts/iosMigration";

type Auth0DatabaseSignupResult = "created" | "exists";

type Auth0ErrorRecord = Record<string, unknown>;

interface Auth0SignupError {
  code?: string;
  detail?: string;
}

class Auth0DatabaseSignupError extends Error {
  status: number;

  // signup error
  constructor(status: number, detail?: string) {
    super(detail || `Auth0 database signup failed with status ${status}`);
    this.name = "Auth0DatabaseSignupError";
    this.status = status;
  }
}

// object response guard
const isAuth0ErrorRecord = (value: unknown): value is Auth0ErrorRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

// auth0 rule interpolation
const formatAuth0RuleText = (template: string, values: unknown): string => {
  const replacements = Array.isArray(values)
    ? values.filter(
        (value): value is number | string =>
          typeof value === "number" || typeof value === "string"
      )
    : [];
  let replacementIndex = 0;
  return template.replace(/%[ds]/g, () => {
    const replacement = replacements[replacementIndex];
    replacementIndex += 1;
    return replacement === undefined ? "" : String(replacement);
  });
};

// failed password rule detail
const getAuth0RuleDetail = (value: unknown): string | undefined => {
  // rule shape guard
  if (!isAuth0ErrorRecord(value) || typeof value.message !== "string") {
    return undefined;
  }
  // satisfied rule guard
  if (value.verified === true) {
    return undefined;
  }
  const requirement = formatAuth0RuleText(value.message, value.format);
  // nested rule guard
  if (!Array.isArray(value.items)) {
    return requirement;
  }
  const missingItems = value.items.flatMap((item) => {
    // failed item guard
    if (
      !isAuth0ErrorRecord(item) ||
      item.verified === true ||
      typeof item.message !== "string"
    ) {
      return [];
    }
    return [formatAuth0RuleText(item.message, item.format)];
  });
  return missingItems.length > 0
    ? `${requirement} Missing: ${missingItems.join(", ")}`
    : requirement;
};

// auth0 signup response detail
const getAuth0SignupError = async (
  response: Response
): Promise<Auth0SignupError> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {};
  }
  // response shape guard
  if (!isAuth0ErrorRecord(body)) {
    return {};
  }
  const code = typeof body.code === "string" ? body.code : undefined;
  // direct description guard
  if (typeof body.description === "string" && body.description.trim()) {
    return { code, detail: body.description.trim() };
  }
  // oauth description guard
  if (
    typeof body.error_description === "string" &&
    body.error_description.trim()
  ) {
    return { code, detail: body.error_description.trim() };
  }
  const summary =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : undefined;
  // structured password detail guard
  if (
    isAuth0ErrorRecord(body.description) &&
    Array.isArray(body.description.rules)
  ) {
    const rules = body.description.rules.flatMap((rule) => {
      const detail = getAuth0RuleDetail(rule);
      return detail ? [detail] : [];
    });
    // detailed rule guard
    if (rules.length > 0) {
      return {
        code,
        detail: [summary, ...rules].filter(Boolean).join(". "),
      };
    }
  }
  return { code, detail: summary };
};

// generic existing-user response guard
const isGenericExistingSignup = ({ code, detail }: Auth0SignupError): boolean =>
  code === "invalid_signup" &&
  /^invalid\s+["']?sign\s*up["']?\.?$/i.test(detail || "");

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
  const auth0Error = await getAuth0SignupError(response);
  // generic existing identity guard
  if (isGenericExistingSignup(auth0Error)) {
    return "exists";
  }
  throw new Auth0DatabaseSignupError(response.status, auth0Error.detail);
};

/** Opens the web client because the dedicated iOS Auth0 client has no Google connection. */
export const openWebIosMigration = async (url: string): Promise<void> => {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
};
