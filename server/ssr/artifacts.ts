import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  PUBLIC_SSR_RENDERER_ARTIFACT_VERSION,
  type PublicSsrRendererArtifact,
} from "shared/contracts/ssrRenderer";

export interface SsrArtifactPaths {
  clientDirectory: string;
  rendererPath: string;
}

type ClientManifestEntry = {
  assets?: unknown;
  css?: unknown;
  file?: unknown;
  dynamicImports?: unknown;
  imports?: unknown;
  isEntry?: unknown;
};

type ClientManifest = Record<string, ClientManifestEntry>;

const resolveDefaultPaths = (): SsrArtifactPaths => {
  const distributionDirectory = path.resolve(__dirname, "..");
  return {
    clientDirectory: path.join(distributionDirectory, "client"),
    rendererPath: path.join(distributionDirectory, "ssr", "entry-server.mjs"),
  };
};

const readRequiredFile = async (
  filePath: string,
  label: string
): Promise<string> => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new Error(`SSR ${label} is missing or unreadable: ${filePath}`);
  }
};

const assertInsideClientDirectory = (
  clientDirectory: string,
  assetPath: string
): string => {
  const resolved = path.resolve(clientDirectory, assetPath);
  if (!resolved.startsWith(`${clientDirectory}${path.sep}`)) {
    throw new Error("SSR client manifest contains an unsafe asset path");
  }
  return resolved;
};

const assertManifest = (manifest: unknown): ClientManifest => {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("SSR client manifest must be a JSON object");
  }
  return manifest as ClientManifest;
};

/** Resolves every asset reachable from every browser entry, including chunks. */
const validateManifestAssets = async (
  clientDirectory: string,
  manifestValue: unknown
): Promise<void> => {
  const manifest = assertManifest(manifestValue);
  const entryKeys = Object.entries(manifest)
    .filter(([, entry]) => entry && entry.isEntry === true)
    .map(([key]) => key);
  if (!entryKeys.length) {
    throw new Error("SSR client manifest has no entry asset");
  }

  const assetPaths = new Set<string>();
  const visitedEntries = new Set<string>();
  const visit = (entryKey: string): void => {
    if (visitedEntries.has(entryKey)) {
      return;
    }
    const entry = manifest[entryKey];
    if (!entry || typeof entry !== "object") {
      throw new Error(`SSR client manifest import is missing: ${entryKey}`);
    }
    visitedEntries.add(entryKey);
    [
      entry.file,
      ...(Array.isArray(entry.css) ? entry.css : []),
      ...(Array.isArray(entry.assets) ? entry.assets : []),
    ].forEach((asset) => {
      if (typeof asset === "string") {
        assetPaths.add(asset);
      }
    });
    const imports = [
      ...(Array.isArray(entry.imports) ? entry.imports : []),
      ...(Array.isArray(entry.dynamicImports) ? entry.dynamicImports : []),
    ];
    imports.forEach((importKey) => {
      if (typeof importKey !== "string") {
        throw new Error("SSR client manifest import must be a string");
      }
      visit(importKey);
    });
  };
  entryKeys.forEach(visit);
  if (!assetPaths.size) {
    throw new Error("SSR client manifest does not reference any assets");
  }

  await Promise.all(
    [...assetPaths].map(async (assetPath) => {
      const resolved = assertInsideClientDirectory(clientDirectory, assetPath);
      try {
        if (!(await stat(resolved)).isFile()) {
          throw new Error("not a file");
        }
      } catch {
        throw new Error(`SSR client manifest asset is missing: ${assetPath}`);
      }
    })
  );
};

/** Reject an index.html from a different client build than its manifest. */
const validateTemplateEntryAssets = (
  template: string,
  manifestValue: unknown
): void => {
  const manifest = assertManifest(manifestValue);
  // The client build has a separate offline.html entry which is intentionally
  // absent from the server document template. Validate only the index entry
  // against index.html while validateManifestAssets covers every built entry.
  const indexEntry = manifest["index.html"];
  const entryFiles =
    indexEntry?.isEntry === true && typeof indexEntry.file === "string"
      ? [indexEntry.file]
      : Object.values(manifest)
          .filter((entry) => entry?.isEntry === true)
          .map((entry) => entry.file)
          .filter((file): file is string => typeof file === "string");
  if (!entryFiles.length) {
    throw new Error("SSR client manifest has no entry asset");
  }
  entryFiles.forEach((entryFile) => {
    const escaped = entryFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(?:src|href)=["']/?${escaped}["']`).test(template)) {
      throw new Error(
        `SSR client index.html does not reference manifest entry: ${entryFile}`
      );
    }
  });
};

/** Validates the production HTML/manifest/ESM renderer before accepting traffic. */
export class SsrArtifacts {
  private renderer: PublicSsrRendererArtifact | undefined;
  private template: string | undefined;

  constructor(
    private readonly paths: SsrArtifactPaths = resolveDefaultPaths()
  ) {}

  async getRenderer(): Promise<PublicSsrRendererArtifact> {
    if (this.renderer) {
      return this.renderer;
    }
    try {
      if (!(await stat(this.paths.rendererPath)).isFile()) {
        throw new Error("not a file");
      }
    } catch {
      throw new Error(
        `SSR renderer artifact is missing: ${this.paths.rendererPath}`
      );
    }
    let loaded: unknown;
    try {
      loaded = await import(pathToFileURL(this.paths.rendererPath).href);
    } catch {
      throw new Error("SSR renderer artifact could not be loaded");
    }
    if (
      !loaded ||
      typeof loaded !== "object" ||
      (loaded as { artifactVersion?: unknown }).artifactVersion !==
        PUBLIC_SSR_RENDERER_ARTIFACT_VERSION ||
      typeof (loaded as { renderPublicSsrDocument?: unknown })
        .renderPublicSsrDocument !== "function"
    ) {
      throw new Error(
        `SSR renderer artifact must export version ${PUBLIC_SSR_RENDERER_ARTIFACT_VERSION} and renderPublicSsrDocument()`
      );
    }
    this.renderer = loaded as PublicSsrRendererArtifact;
    return this.renderer;
  }

  async getTemplate(): Promise<string> {
    if (this.template !== undefined) {
      return this.template;
    }
    const indexPath = path.join(this.paths.clientDirectory, "index.html");
    const manifestPath = path.join(
      this.paths.clientDirectory,
      ".vite",
      "manifest.json"
    );
    const [template, manifestText] = await Promise.all([
      readRequiredFile(indexPath, "client index.html"),
      readRequiredFile(manifestPath, "client manifest"),
    ]);
    if (!/<div\b[^>]*\bid=(['"])root\1[^>]*>/i.test(template)) {
      throw new Error("SSR client index.html is missing #root");
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      throw new Error("SSR client manifest is invalid JSON");
    }
    await validateManifestAssets(this.paths.clientDirectory, manifest);
    validateTemplateEntryAssets(template, manifest);
    this.template = template;
    return template;
  }
}

/** Loads artifacts relative to the compiled CJS server directory. */
export const loadProductionSsrArtifacts = async (
  serverDirectory = __dirname
): Promise<SsrArtifacts> => {
  const distributionDirectory = path.resolve(serverDirectory, "..");
  const artifacts = new SsrArtifacts({
    clientDirectory: path.join(distributionDirectory, "client"),
    rendererPath: path.join(distributionDirectory, "ssr", "entry-server.mjs"),
  });
  await Promise.all([artifacts.getRenderer(), artifacts.getTemplate()]);
  return artifacts;
};
