import { createHash, createHmac } from "node:crypto";

import { withGoogleCloudRequestTimeout } from "./requestTimeout";

const ECS_CREDENTIALS_HOST = "http://169.254.170.2";
const ECS_CREDENTIALS_PATH = /^\/v2\/credentials\/[A-Za-z0-9-]+$/;
const GOOGLE_STS_ENDPOINT = "https://sts.googleapis.com/v1/token";
const MONITORING_WRITE_SCOPE =
  "https://www.googleapis.com/auth/monitoring.write";
const PROVIDER_RESOURCE =
  /^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/;

export interface AwsTemporaryCredentials {
  accessKeyId: string;
  expiration: string;
  secretAccessKey: string;
  token: string;
}

export interface AwsWifConfiguration {
  awsRegion: string;
  providerResource: string;
}

export interface GoogleAccessToken {
  accessToken: string;
  expiresAt: number;
}

export interface SignedAwsSubjectToken {
  headers: { key: string; value: string }[];
  method: "POST";
  url: string;
}

interface AwsWifDependencies {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** Returns a lowercase SHA-256 digest. */
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Computes one SigV4 HMAC stage. */
function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** Encodes an AWS canonical query component. */
function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Canonicalizes a fixed query map for SigV4. */
function canonicalQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
}

/** Builds a signed, serialized AWS GetCallerIdentity request. */
export function createSignedGetCallerIdentitySubjectToken(input: {
  credentials: AwsTemporaryCredentials;
  now: Date;
  providerResource: string;
  region: string;
}): SignedAwsSubjectToken {
  // reject arbitrary WIF audiences before signing them
  if (!PROVIDER_RESOURCE.test(input.providerResource)) {
    throw new Error("Invalid Google workload identity provider resource");
  }
  // reject arbitrary regions before constructing a host
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(input.region)) {
    throw new Error("Invalid AWS region");
  }
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const host = `sts.${input.region}.amazonaws.com`;
  const query = canonicalQuery({
    Action: "GetCallerIdentity",
    Version: "2011-06-15",
  });
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-security-token:${input.credentials.token.trim()}`,
    `x-goog-cloud-target-resource:${input.providerResource}`,
    "",
  ].join("\n");
  const signedHeaders =
    "host;x-amz-date;x-amz-security-token;x-goog-cloud-target-resource";
  const canonicalRequest = [
    "POST",
    "/",
    query,
    canonicalHeaders,
    signedHeaders,
    sha256(""),
  ].join("\n");
  const credentialScope = `${date}/${input.region}/sts/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${input.credentials.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, "sts");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/` +
    `${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    headers: [
      { key: "Authorization", value: authorization },
      { key: "host", value: host },
      { key: "x-amz-date", value: amzDate },
      {
        key: "x-amz-security-token",
        value: input.credentials.token.trim(),
      },
      {
        key: "x-goog-cloud-target-resource",
        value: input.providerResource,
      },
    ],
    method: "POST",
    url: `https://${host}?${query}`,
  };
}

/** Loads temporary task-role credentials from the fixed ECS metadata host. */
async function readEcsCredentials(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<AwsTemporaryCredentials> {
  const relativeUri = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  // reject missing, absolute, or arbitrary metadata paths
  if (!relativeUri || !ECS_CREDENTIALS_PATH.test(relativeUri)) {
    throw new Error("Invalid ECS credentials relative URI");
  }
  // keep credential body reads inside the request deadline
  return await withGoogleCloudRequestTimeout(async (signal) => {
    const response = await fetchImpl(`${ECS_CREDENTIALS_HOST}${relativeUri}`, {
      signal,
    });
    // fail closed on metadata errors
    if (!response.ok) {
      throw new Error("Unable to load ECS task credentials");
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const credentials = {
      accessKeyId: payload.AccessKeyId,
      expiration: payload.Expiration,
      secretAccessKey: payload.SecretAccessKey,
      token: payload.Token,
    };
    // validate required credential values without exposing them
    if (
      typeof credentials.accessKeyId !== "string" ||
      typeof credentials.expiration !== "string" ||
      typeof credentials.secretAccessKey !== "string" ||
      typeof credentials.token !== "string"
    ) {
      throw new Error("Invalid ECS task credentials response");
    }
    return credentials as AwsTemporaryCredentials;
  });
}

/** Exchanges the signed AWS request for a short-lived Monitoring token. */
async function exchangeSubjectToken(input: {
  fetchImpl: typeof fetch;
  providerResource: string;
  subjectToken: SignedAwsSubjectToken;
}): Promise<{ accessToken: string; expiresIn: number }> {
  // keep token response parsing inside the exchange deadline
  return await withGoogleCloudRequestTimeout(async (signal) => {
    const response = await input.fetchImpl(GOOGLE_STS_ENDPOINT, {
      body: new URLSearchParams({
        audience: input.providerResource,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope: MONITORING_WRITE_SCOPE,
        subject_token: encodeURIComponent(JSON.stringify(input.subjectToken)),
        subject_token_type: "urn:ietf:params:aws:token-type:aws4_request",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
    });
    // return a bounded error without provider response contents
    if (!response.ok) {
      throw new Error("Google workload identity exchange failed");
    }
    const payload = (await response.json()) as Record<string, unknown>;
    // validate the narrow token response
    if (
      typeof payload.access_token !== "string" ||
      typeof payload.expires_in !== "number"
    ) {
      throw new Error("Invalid Google workload identity response");
    }
    return {
      accessToken: payload.access_token,
      expiresIn: payload.expires_in,
    };
  });
}

/** Creates a cached AWS-WIF Monitoring token provider. */
export function createAwsWifTokenProvider(
  configuration: AwsWifConfiguration,
  dependencies: AwsWifDependencies = {}
): { getAccessToken(): Promise<string> } {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const cache: { token: GoogleAccessToken | null } = { token: null };

  return {
    // reuse only tokens with at least one minute remaining
    async getAccessToken() {
      const nowMillis = now().getTime();
      // keep short-lived credentials only in process memory
      if (cache.token && cache.token.expiresAt - nowMillis > 60_000) {
        return cache.token.accessToken;
      }
      const credentials = await readEcsCredentials(env, fetchImpl);
      const subjectToken = createSignedGetCallerIdentitySubjectToken({
        credentials,
        now: new Date(nowMillis),
        providerResource: configuration.providerResource,
        region: configuration.awsRegion,
      });
      const exchanged = await exchangeSubjectToken({
        fetchImpl,
        providerResource: configuration.providerResource,
        subjectToken,
      });
      // let equivalent concurrent exchanges converge on the newest token
      // eslint-disable-next-line require-atomic-updates
      cache.token = {
        accessToken: exchanged.accessToken,
        expiresAt: nowMillis + exchanged.expiresIn * 1_000,
      };
      return cache.token.accessToken;
    },
  };
}
