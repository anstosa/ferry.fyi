import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ImageViolation {
  filePath: string;
  line: number;
  reason: string;
}

// collect source files
const getSourceFiles = (directory: string, extension: RegExp): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    // descend into source directories
    if (entry.isDirectory()) {
      return getSourceFiles(filePath, extension);
    }
    return extension.test(entry.name) ? [filePath] : [];
  });

// format one source location
const getViolation = (
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  reason: string
): ImageViolation => ({
  filePath: path.relative(process.cwd(), filePath),
  line:
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1,
  reason,
});

// reject statically invalid alt values
const hasValidJsxAlt = (attribute: ts.JsxAttribute): boolean => {
  // shorthand alt is not text
  if (!attribute.initializer) {
    return false;
  }
  // quoted alt text is valid, including decorative empty text
  if (ts.isStringLiteral(attribute.initializer)) {
    return true;
  }
  const { expression } = attribute.initializer;
  // require a runtime value
  if (!expression) {
    return false;
  }
  return !(
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined")
  );
};

// audit intrinsic JSX images
const getJsxImageViolations = (filePath: string): ImageViolation[] => {
  const source = readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const violations: ImageViolation[] = [];

  // inspect nested JSX nodes
  const visit = (node: ts.Node): void => {
    let openingElement: ts.JsxOpeningLikeElement | undefined;
    // normalize paired elements
    if (ts.isJsxElement(node)) {
      ({ openingElement } = node);
    } else if (ts.isJsxSelfClosingElement(node)) {
      // normalize self-closing elements
      openingElement = node;
    }
    // inspect intrinsic images only
    if (openingElement?.tagName.getText(sourceFile) === "img") {
      const alt = openingElement.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "alt"
      );
      // require a valid alt attribute
      if (!alt || !hasValidJsxAlt(alt)) {
        violations.push(
          getViolation(
            filePath,
            sourceFile,
            openingElement,
            "missing valid alt"
          )
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

// audit static HTML images
const getHtmlImageViolations = (filePath: string): ImageViolation[] => {
  const html = readFileSync(filePath, "utf-8");
  const { document } = new JSDOM(html).window;
  return [...document.querySelectorAll("img:not([alt])")].map((image) => ({
    filePath: path.relative(process.cwd(), filePath),
    line: html.slice(0, html.indexOf(image.outerHTML)).split("\n").length,
    reason: "missing alt",
  }));
};

describe("first-party images", () => {
  it("provides valid alt attributes for every intrinsic JSX image", () => {
    const sourceFiles = getSourceFiles(path.resolve("client"), /\.tsx$/);
    const violations = sourceFiles.flatMap(getJsxImageViolations);

    expect(violations).toEqual([]);
  });

  it("provides alt attributes for static HTML images", () => {
    const staticHtmlFiles = [
      path.resolve("client/index.html"),
      path.resolve("client/offline.html"),
      path.resolve("scripts/camera-polygon-annotator/index.html"),
    ];
    const violations = staticHtmlFiles.flatMap((filePath) =>
      getHtmlImageViolations(filePath)
    );

    expect(violations).toEqual([]);
  });
});
