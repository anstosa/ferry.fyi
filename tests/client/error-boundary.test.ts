// @vitest-environment jsdom

import React, { act, ReactElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../../client/components/ErrorBoundary";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

// render react tree
const renderElement = (element: ReactElement): RenderResult => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
};

// always crashes
const ThrowingChild = (): ReactElement => {
  throw new Error("boundary test crash");
};

interface MaybeThrowingChildProps {
  shouldThrow: boolean;
}

// conditionally crashes
const MaybeThrowingChild = ({
  shouldThrow,
}: MaybeThrowingChildProps): ReactElement => {
  // crash guard
  if (shouldThrow) {
    throw new Error("boundary reset crash");
  }
  return React.createElement("span", null, "Recovered content");
};

// boundary behavior
describe("ErrorBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  // silence react error logs
  beforeEach(() => {
    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  // cleanup mounted dom
  afterEach(() => {
    consoleError.mockRestore();
    document.body.innerHTML = "";
  });

  // fallback case
  it("renders fallback content when a child crashes", () => {
    const { container } = renderElement(
      React.createElement(
        ErrorBoundary,
        { fallbackTitle: "Fallback shown" },
        React.createElement(ThrowingChild)
      )
    );

    expect(container.textContent).toContain("Fallback shown");
    expect(container.textContent).toContain("Try again");
  });

  // reset case
  it("resets after the reset key changes", () => {
    const { container, root } = renderElement(
      React.createElement(
        ErrorBoundary,
        { fallbackTitle: "Broken view", resetKey: "broken" },
        React.createElement(MaybeThrowingChild, { shouldThrow: true })
      )
    );

    expect(container.textContent).toContain("Broken view");

    // rerender after reset
    act(() => {
      root.render(
        React.createElement(
          ErrorBoundary,
          { fallbackTitle: "Broken view", resetKey: "healthy" },
          React.createElement(MaybeThrowingChild, { shouldThrow: false })
        )
      );
    });

    expect(container.textContent).toContain("Recovered content");
  });
});
