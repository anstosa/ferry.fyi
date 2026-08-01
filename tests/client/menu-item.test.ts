import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { MenuItem } from "../../client/views/Menu/MenuItem";

describe("menu item markup", () => {
  it("renders the flexible spacer as a valid list item", () => {
    const document = new JSDOM(
      renderToStaticMarkup(
        React.createElement(
          "ul",
          null,
          React.createElement(MenuItem, { item: { isSpacer: true } })
        )
      )
    ).window.document;
    const list = document.querySelector("ul");
    const spacer = list?.firstElementChild;

    expect(list?.children).toHaveLength(1);
    expect(spacer?.tagName).toBe("LI");
    expect(spacer?.getAttribute("aria-hidden")).toBe("true");
  });
});
