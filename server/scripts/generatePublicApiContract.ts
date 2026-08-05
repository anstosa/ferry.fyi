import fs from "node:fs";
import path from "node:path";

import {
  type PublicApiOperation,
  publicApiOperations,
} from "shared/contracts/publicApiOperations";

const repoRoot = path.resolve(__dirname, "../..");
const outputPath = path.join(repoRoot, "client/static/openapi.json");

const errorResponse = {
  content: {
    "application/json": {
      example: {
        body: { error: "api_not_found" },
        wsfStatus: { offline: false },
      },
      schema: { $ref: "#/components/schemas/ApiEnvelope" },
    },
  },
  description:
    "Deterministic API error envelope. Error responses are no-store and noindex.",
};

interface OpenApiParameter {
  in: "path" | "query";
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
}

const parametersFor = (operation: PublicApiOperation): OpenApiParameter[] => {
  const parameters: OpenApiParameter[] = [
    ...operation.path.matchAll(/\{([^}]+)\}/g),
  ].map(([, name]) => ({
    in: "path",
    name,
    required: true,
    schema:
      name === "date"
        ? { format: "date", type: "string" }
        : { minLength: 1, type: "string" },
  }));
  if (operation.path.includes("/cameras/")) {
    parameters.push({
      in: "query",
      name: "ids",
      required: false,
      schema: { type: "string" },
    });
  }
  if (operation.path.includes("/leaderboards/")) {
    parameters.push({
      in: "query",
      name: "period",
      required: false,
      schema: { enum: ["all", "month", "week"], type: "string" },
    });
  }
  return parameters;
};

const securityFor = (
  authClass: PublicApiOperation["auth"]
): ({ bearerAuth: never[] } | Record<string, never>)[] => {
  if (authClass === "bearer") {
    return [{ bearerAuth: [] }];
  }
  if (authClass === "sensitive-id") {
    return [{}, { bearerAuth: [] }];
  }
  return [];
};

const paths: Record<string, Record<string, unknown>> = {};
for (const operation of publicApiOperations.filter(
  ({ includeInOpenApi }) => includeInOpenApi
) as readonly PublicApiOperation[]) {
  const method = operation.method.toLowerCase();
  paths[operation.path] ??= {};
  paths[operation.path][method] = {
    description: `${operation.freshness} Cache class: ${operation.cache}. Rate class: ${operation.rate}. Ferry FYI provides best-effort operational data, not an SLA.`,
    operationId: operation.operationId,
    parameters: parametersFor(operation),
    requestBody:
      operation.method === "POST"
        ? {
            content: {
              "application/json": {
                example: {},
                schema: { additionalProperties: true, type: "object" },
              },
            },
            required: true,
          }
        : undefined,
    responses: {
      "200": {
        content: {
          "application/json": {
            example: {
              body: {},
              wsfStatus: { offline: false },
            },
            schema: { $ref: "#/components/schemas/ApiEnvelope" },
          },
        },
        description: `${operation.responseClass} response`,
      },
      "400": errorResponse,
      "401": errorResponse,
      "404": errorResponse,
      "429": errorResponse,
      "500": errorResponse,
      "503": errorResponse,
    },
    security: securityFor(operation.auth),
    summary: operation.summary,
    tags: [operation.featureGate ?? "ferries"],
  };
}

const document = {
  components: {
    schemas: {
      ApiEnvelope: {
        additionalProperties: false,
        properties: {
          body: {},
          wsfStatus: { $ref: "#/components/schemas/WsfStatus" },
        },
        required: ["body", "wsfStatus"],
        type: "object",
      },
      WsfStatus: {
        additionalProperties: false,
        properties: {
          coreReady: { type: "boolean" },
          offline: { type: "boolean" },
          warming: { type: "boolean" },
        },
        required: ["offline"],
        type: "object",
      },
    },
    securitySchemes: {
      bearerAuth: { bearerFormat: "JWT", scheme: "bearer", type: "http" },
    },
  },
  info: {
    description:
      "Read-oriented Ferry FYI operational data. Preserve timestamps, freshness, state, and observed-versus-predictive distinctions. Do not treat forecasts as guarantees.",
    title: "Ferry FYI public API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths,
  servers: [{ url: "https://ferry.fyi" }],
  tags: [
    {
      description:
        "Schedules, terminals, vessels, cameras, fares, tickets, accounts, and feature status.",
      name: "ferries",
    },
    {
      description: "Feature-gated public ranking reads.",
      name: "leaderboards",
    },
  ],
};

const serialized = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (
    !fs.existsSync(outputPath) ||
    fs.readFileSync(outputPath, "utf8") !== serialized
  ) {
    throw new Error(
      "client/static/openapi.json is not generated from the canonical operation matrix"
    );
  }
  process.stdout.write(
    "OpenAPI artifact matches the canonical operation matrix\n"
  );
} else {
  fs.writeFileSync(outputPath, serialized);
  process.stdout.write(`Wrote ${path.relative(repoRoot, outputPath)}\n`);
}
