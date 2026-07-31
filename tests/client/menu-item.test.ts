import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MenuItem } from "../../client/views/Menu/MenuItem";

describe("menu item markup", () => {
  it("renders the flexible spacer as a valid list item", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MenuItem, { item: { isSpacer: true } })
    );

    expect(markup).toBe('<li aria-hidden="true" class="flex-grow"></li>');
  });
});
