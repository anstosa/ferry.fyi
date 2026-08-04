import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  advertisedPublicApiOperations,
  dataSourcesPublicApiOperations,
  openApiOperations,
  publicApiOperations,
} from "../../shared/contracts/publicApiOperations";

const repoRoot = path.resolve(__dirname, "../..");
const openapi = JSON.parse(
  readFileSync(path.join(repoRoot, "client/static/openapi.json"), "utf8")
) as {
  components: { securitySchemes: Record<string, unknown> };
  paths: Record<string, Record<string, Record<string, unknown>>>;
};
const llms = readFileSync(
  path.join(repoRoot, "client/static/llms.txt"),
  "utf8"
);
const dataSources = readFileSync(
  path.join(repoRoot, "client/views/DataSources.tsx"),
  "utf8"
);

const llmsPath = (value: string) =>
  value
    .replace("{terminalId}", ":terminalId")
    .replace("{vesselId}", ":vesselId")
    .replace("{ticketId}", ":ticketId")
    .replace("{departingId}", ":departingId")
    .replace("{arrivingId}", ":arrivingId")
    .replace("{date}", ":YYYY-MM-DD");

describe("public API operation contract", () => {
  it("includes every llms-advertised operation in OpenAPI", () => {
    for (const operation of advertisedPublicApiOperations) {
      expect(llms).toContain(`${operation.method} ${llmsPath(operation.path)}`);
      expect(
        openapi.paths[operation.path]?.[operation.method.toLowerCase()]
      ).toBeDefined();
    }
  });

  it("keeps OpenAPI exactly aligned with canonical inclusion flags", () => {
    const generated = Object.entries(openapi.paths)
      .flatMap(([operationPath, methods]) =>
        Object.keys(methods).map(
          (method) => `${method.toUpperCase()} ${operationPath}`
        )
      )
      .sort();
    const canonical = openApiOperations
      .map(({ method, path: operationPath }) => `${method} ${operationPath}`)
      .sort();
    expect(generated).toEqual(canonical);
    expect(openapi.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it("requires auth, cache, rate, freshness, and valid envelope examples", () => {
    for (const operation of openApiOperations) {
      const generated = openapi.paths[operation.path][
        operation.method.toLowerCase()
      ] as {
        description: string;
        responses: Record<
          string,
          {
            content: {
              "application/json": { example: Record<string, unknown> };
            };
          }
        >;
        security: unknown[];
      };
      expect(generated.description).toContain(operation.cache);
      expect(generated.description).toContain(operation.rate);
      expect(generated.description).toContain(operation.freshness);
      expect(generated.security).toHaveLength(
        operation.auth === "bearer" ? 1 : 0
      );
      for (const response of Object.values(generated.responses)) {
        const { example } = response.content["application/json"];
        expect(example).toHaveProperty("body");
        expect(example).toHaveProperty("wsfStatus.offline", false);
      }
    }
  });

  it("keeps data-sources a qualified subset and internal refreshes private", () => {
    for (const operation of dataSourcesPublicApiOperations) {
      expect(dataSources).toContain(llmsPath(operation.path));
    }
    const internal = publicApiOperations.find(
      ({ operationId }) => operationId === "refreshVesselsInternal"
    );
    expect(internal).toMatchObject({
      advertiseInLlms: false,
      documentInDataSources: false,
      includeInOpenApi: false,
    });
  });
});
