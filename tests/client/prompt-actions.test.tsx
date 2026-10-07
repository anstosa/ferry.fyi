// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client/components/Toast", () => ({
  Toast: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
}));

import { Prompt } from "../../client/components/Prompt";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// render one prompt action
const renderAction = (onClick?: () => void): HTMLAnchorElement => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <Prompt
        actions={[
          {
            href: "https://store.example/ferry",
            label: "Open store",
            onClick,
          },
        ]}
      />
    );
  });
  const link = container.querySelector<HTMLAnchorElement>("a");
  // required fixture link
  if (!link) {
    throw new Error("Prompt href action did not render");
  }
  return link;
};

describe("Prompt href actions", () => {
  // callback preserves the href
  it("preserves navigation and invokes the optional callback once", () => {
    const onClick = vi.fn();
    const link = renderAction(onClick);

    act(() => link.click());

    expect(link.href).toBe("https://store.example/ferry");
    expect(onClick).toHaveBeenCalledOnce();
  });

  // callback remains optional
  it("preserves href actions without a callback", () => {
    const link = renderAction();

    expect(() => act(() => link.click())).not.toThrow();
    expect(link.href).toBe("https://store.example/ferry");
  });
});
