import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const getClientSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return getClientSourceFiles(filePath);
    }
    return /\.(html|tsx)$/.test(entry.name) ? [filePath] : [];
  });

describe("client images", () => {
  it("provides alt text for every image", () => {
    const sourceFiles = getClientSourceFiles(path.resolve("client"));
    const imagesWithoutAlt = sourceFiles.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf-8");
      const imageTags = source.match(/<img\b[\s\S]*?>/g) ?? [];
      return imageTags
        .filter((tag) => !/\balt\s*=/.test(tag))
        .map((tag) => `${path.relative(process.cwd(), filePath)}: ${tag}`);
    });

    expect(imagesWithoutAlt).toEqual([]);
  });
});
