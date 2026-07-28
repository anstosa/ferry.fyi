import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dateButtonSource = readFileSync(
  "client/components/DateButton.tsx",
  "utf-8"
);
const globalStyles = readFileSync("client/app.scss", "utf-8");
const dateButtonStylesPath = "client/components/DateButton.scss";

describe("DateButton styles", () => {
  it("loads calendar styles with the lazy DateButton component", () => {
    expect(dateButtonSource).toContain('import "./DateButton.scss";');
    expect(globalStyles).not.toContain("react-day-picker/style.css");
    expect(existsSync(dateButtonStylesPath)).toBe(true);

    const dateButtonStyles = readFileSync(dateButtonStylesPath, "utf-8");

    expect(dateButtonStyles).toContain('@import "react-day-picker/style.css";');
    expect(dateButtonStyles).toContain(".date-button-picker");
    expect(dateButtonStyles).toContain("@apply absolute z-10;");
    expect(dateButtonStyles).toContain("right: -1px;");
    expect(dateButtonStyles).toContain("top: 100%;");
    expect(dateButtonSource).toContain('"border-b-0 rounded-b-none": isOpen');
  });
});
