import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SsrArtifacts } from "~/ssr/artifacts";

const temporaryDirectories: string[] = [];

const createArtifacts = async (
  manifest: object,
  files: string[]
): Promise<{ artifacts: SsrArtifacts; clientDirectory: string }> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "ferry-ssr-artifacts-")
  );
  temporaryDirectories.push(directory);
  const clientDirectory = path.join(directory, "client");
  await mkdir(path.join(clientDirectory, ".vite"), { recursive: true });
  await writeFile(
    path.join(clientDirectory, "index.html"),
    '<html><body><div id="root"></div><script src="/assets/entry.js"></script></body></html>'
  );
  await writeFile(
    path.join(clientDirectory, ".vite", "manifest.json"),
    JSON.stringify(manifest)
  );
  await Promise.all(
    files.map(async (file) => {
      const target = path.join(clientDirectory, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "artifact");
    })
  );
  return {
    artifacts: new SsrArtifacts({
      clientDirectory,
      rendererPath: path.join(directory, "entry-server.mjs"),
    }),
    clientDirectory,
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("SsrArtifacts", () => {
  it("validates assets recursively through manifest imports", async () => {
    const { artifacts } = await createArtifacts(
      {
        "entry-client.tsx": {
          file: "assets/entry.js",
          dynamicImports: ["dynamic.ts"],
          imports: ["shared.ts"],
          isEntry: true,
        },
        "dynamic.ts": { file: "assets/dynamic.js" },
        "shared.ts": {
          assets: ["assets/icon.svg"],
          css: ["assets/shared.css"],
          file: "assets/shared.js",
        },
      },
      [
        "assets/entry.js",
        "assets/shared.js",
        "assets/dynamic.js",
        "assets/shared.css",
        "assets/icon.svg",
      ]
    );

    await expect(artifacts.getTemplate()).resolves.toContain('id="root"');
  });

  it("rejects a missing recursively imported manifest asset", async () => {
    const { artifacts } = await createArtifacts(
      {
        entry: { file: "assets/entry.js", imports: ["chunk"], isEntry: true },
        chunk: { file: "assets/missing.js" },
      },
      ["assets/entry.js"]
    );

    await expect(artifacts.getTemplate()).rejects.toThrow(
      "SSR client manifest asset is missing: assets/missing.js"
    );
  });

  it("rejects a manifest import that does not identify an entry", async () => {
    const { artifacts } = await createArtifacts(
      {
        entry: { file: "assets/entry.js", imports: ["missing"], isEntry: true },
      },
      ["assets/entry.js"]
    );

    await expect(artifacts.getTemplate()).rejects.toThrow(
      "SSR client manifest import is missing: missing"
    );
  });

  it("rejects a stale template without its manifest browser entry", async () => {
    const { artifacts, clientDirectory } = await createArtifacts(
      { entry: { file: "assets/entry.js", isEntry: true } },
      ["assets/entry.js"]
    );
    await writeFile(
      path.join(clientDirectory, "index.html"),
      '<html><body><div id="root"></div></body></html>'
    );

    await expect(artifacts.getTemplate()).rejects.toThrow(
      "SSR client index.html does not reference manifest entry: assets/entry.js"
    );
  });

  it("finds production artifacts beside the compiled server directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ferry-ssr-dist-"));
    temporaryDirectories.push(directory);
    const distributionDirectory = path.join(directory, "dist");
    const clientDirectory = path.join(distributionDirectory, "client");
    const serverDirectory = path.join(distributionDirectory, "server");
    const rendererPath = path.join(
      distributionDirectory,
      "ssr",
      "entry-server.mjs"
    );
    await mkdir(path.join(clientDirectory, ".vite"), { recursive: true });
    await mkdir(serverDirectory, { recursive: true });
    await mkdir(path.dirname(rendererPath), { recursive: true });
    await writeFile(
      path.join(clientDirectory, "index.html"),
      '<html><body><div id="root"></div><script src="/assets/entry.js"></script></body></html>'
    );
    await writeFile(
      path.join(clientDirectory, ".vite", "manifest.json"),
      JSON.stringify({ entry: { file: "assets/entry.js", isEntry: true } })
    );
    await mkdir(path.join(clientDirectory, "assets"), { recursive: true });
    await writeFile(
      path.join(clientDirectory, "assets", "entry.js"),
      "artifact"
    );
    await writeFile(
      rendererPath,
      "export const artifactVersion = 1; export const renderPublicSsrDocument = () => ({});"
    );

    const { loadProductionSsrArtifacts } = await import("~/ssr/artifacts");
    await expect(
      loadProductionSsrArtifacts(serverDirectory)
    ).resolves.toBeDefined();
  });
});
