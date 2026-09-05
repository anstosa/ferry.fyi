import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

// exercise the installed dependency implementations
const require = createRequire(import.meta.url);
const qs = require("qs");
const browserslist = require("browserslist");

// guard query parsing and serialization advisories
describe("qs security regressions", () => {
  // preserve hostile keys without invoking attacker-controlled values
  it.each([{ plainObjects: true }, { allowPrototypes: true }])(
    "round-trips constructor keys with %j",
    (options) => {
      const parsed = qs.parse("x[constructor][isBuffer]=y", options);

      expect(qs.stringify(parsed)).toBe("x%5Bconstructor%5D%5BisBuffer%5D=y");
    }
  );

  // enforce comma-array limits for flat and bracketed keys
  it.each(["a", "a[]"])("limits comma arrays under %s", (key) => {
    const options = {
      arrayLimit: 3,
      comma: true,
      throwOnLimitExceeded: true,
    };

    // retain valid comma-array input at the limit
    expect(() => qs.parse(`${key}=1,2,3`, options)).not.toThrow();
    // reject excess elements before allocating an oversized array
    expect(() => qs.parse(`${key}=1,2,3,4`, options)).toThrow(RangeError);
  });

  // preserve legitimate buffer serialization
  it("serializes buffers as values", () => {
    expect(qs.stringify({ value: Buffer.from("ferry") })).toBe("value=ferry");
  });
});

// guard untrusted custom browser statistics
describe("browserslist security regressions", () => {
  // treat inherited property names as data rather than browser definitions
  it.each([
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "toString",
    "valueOf",
  ])("accepts stats containing %s without crashing", (key) => {
    const stats = JSON.parse(`{"${key}":{"onekey":5}}`);

    expect(browserslist("chrome 90", { stats })).toEqual(["chrome 90"]);
  });
});

// isolate potentially nonterminating generators from the test runner
describe("nanoid security regressions", () => {
  // cover both published module entry points
  it.each(["commonjs", "module"])(
    "terminates zero-size custom generators in %s",
    (moduleType) => {
      // select the native node loader
      const loader =
        moduleType === "module"
          ? 'import { customAlphabet, customRandom } from "nanoid";'
          : 'const { customAlphabet, customRandom } = require("nanoid");';
      const output = execFileSync(
        process.execPath,
        [
          `--input-type=${moduleType}`,
          "-e",
          `${loader}
          process.stdout.write(JSON.stringify([
            customAlphabet("abc", 0)(),
            customAlphabet("abc")(0),
            customRandom("abc", 0, Buffer.alloc)(),
            customRandom("abc", 21, Buffer.alloc)(0)
          ]));`,
        ],
        { encoding: "utf8", timeout: 2_000 }
      );

      expect(JSON.parse(output)).toEqual(["", "", "", ""]);
    }
  );
});
