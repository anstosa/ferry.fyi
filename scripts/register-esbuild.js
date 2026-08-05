#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const esbuild = require("esbuild");

require("tsconfig-paths/register");

// compile TypeScript on require
function registerExtension(extension) {
  require.extensions[extension] = (module, filename) => {
    const source = readFileSync(filename, "utf8");
    const output = esbuild.transformSync(source, {
      format: "cjs",
      loader: extension === ".tsx" ? "tsx" : "ts",
      sourcemap: "inline",
      supported: {
        // CommonJS require calls pass through tsconfig-paths; native import()
        // does not, so deferred server modules must use the same resolver.
        "dynamic-import": false,
      },
      sourcefile: filename,
      target: "es2020",
      tsconfigRaw: {
        compilerOptions: {
          useDefineForClassFields: false,
        },
      },
    });
    module._compile(output.code, filename);
  };
}

registerExtension(".ts");
registerExtension(".tsx");

const entry = process.argv[2];
// entry guard
if (!entry) {
  throw new Error("Missing TypeScript entrypoint");
}

require(resolve(process.cwd(), entry));
