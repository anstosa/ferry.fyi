// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddressAutocomplete } from "../../client/components/AddressAutocomplete";
import { getAddressSuggestions } from "../../client/lib/addressSuggestions";

const adapters = vi.hoisted(() => ({
  post: vi.fn(),
  change: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("../../client/lib/api", () => ({ post: adapters.post }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const suggestion = {
  address: "Synthetic address, Seattle, WA",
  placeId: "ChIJ_synthetic",
  primaryText: "Synthetic address",
  secondaryText: "Seattle, WA",
};
const success = { available: true, suggestions: [suggestion] };

// mount the controlled input inside a form with an explicit submit boundary
const Harness = ({
  disabled = false,
}: {
  disabled?: boolean;
}): React.ReactElement => {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        // capture only explicit submission in the fixture
        event.preventDefault();
        adapters.submit();
      }}
    >
      <AddressAutocomplete
        className="field"
        disabled={disabled}
        onChange={(next, placeId) => {
          // model the parent retaining only the current selected origin
          setValue(next);
          adapters.change(next, placeId);
        }}
        value={value}
      />
      <button type="submit">Estimate trip</button>
    </form>
  );
};

// read the single accessible address control
const field = (): HTMLInputElement => container.querySelector("input")!;

// edit through native events rather than mutating react state
const edit = async (value: string): Promise<void> => {
  await act(() => {
    field().focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
};

// complete one debounce window without allowing real provider calls
const debounce = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
};

// exercise combobox keyboard input and expose whether form submission is prevented
const key = async (value: string): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  await act(() => {
    field().dispatchEvent(event);
  });
  return event;
};

// isolate the transient fixture and provider adapter
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  adapters.post.mockResolvedValue(success);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root.render(<Harness />);
  });
});

// discard the controlled origin and pending debounce work
afterEach(async () => {
  await act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("google starting-address combobox", () => {
  // keep mount and short input free of paid requests
  it("waits for three characters and debounces rapid edits", async () => {
    expect(field().placeholder).toBe("Starting address");
    expect(field().getAttribute("aria-label")).toBe("Starting address");
    expect(field().getAttribute("role")).toBe("combobox");
    expect(adapters.post).not.toHaveBeenCalled();
    await edit("Se");
    await debounce();
    expect(adapters.post).not.toHaveBeenCalled();
    await edit("Sea");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await edit("Seattle");
    await debounce();
    expect(adapters.post).toHaveBeenCalledExactlyOnceWith(
      "/sailing-recommendations/address-suggestions",
      { input: "Seattle" }
    );
    expect(field().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="option"]')?.textContent).toBe(
      "Synthetic addressSeattle, WA"
    );
    expect(container.querySelector('[translate="no"]')?.textContent).toBe(
      "Google Maps"
    );
  });

  // keep pending feedback inside the input without changing request timing
  it("shows a right-side spinner with a screen-reader-only loading announcement", async () => {
    let resolve!: (value: typeof success) => void;
    adapters.post.mockReturnValue(
      new Promise((done) => {
        // hold the provider completion while checking the pending state
        resolve = done;
      })
    );
    expect(container.querySelector(".animate-spin")).toBeNull();
    await edit("Seattle");
    expect(container.querySelector(".animate-spin")).toBeNull();
    await debounce();
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
    expect(spinner?.parentElement?.parentElement).toBe(field().parentElement);
    expect(spinner?.parentElement?.classList.contains("right-3")).toBe(true);
    expect(spinner?.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(field().classList.contains("pr-10")).toBe(true);
    expect(field().getAttribute("aria-busy")).toBe("true");
    const announcement = container.querySelector('[role="status"]');
    expect(announcement?.classList.contains("sr-only")).toBe(true);
    expect(announcement?.textContent).toBe("Finding addresses…");
    await act(() => {
      resolve(success);
    });
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(field().getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(adapters.post).toHaveBeenCalledOnce();
  });

  // remove loading feedback immediately when the current query is dismissed
  it("clears the spinner on escape and ignores the obsolete completion", async () => {
    let resolve!: (value: typeof success) => void;
    adapters.post.mockReturnValue(
      new Promise((done) => {
        // leave one lookup in flight through dismissal
        resolve = done;
      })
    );
    await edit("Seattle");
    await debounce();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    await key("Escape");
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(field().getAttribute("aria-busy")).toBe("false");
    await act(() => {
      resolve(success);
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  // selecting with enter should set the origin without submitting or re-querying
  it("supports arrow keys and enter without requesting a route", async () => {
    await edit("Seattle");
    await debounce();
    await key("ArrowUp");
    expect(
      container.querySelector('[role="option"]')?.getAttribute("aria-selected")
    ).toBe("true");
    expect(field().getAttribute("aria-activedescendant")).toContain("option-0");
    expect((await key("Enter")).defaultPrevented).toBe(true);
    expect(field().value).toBe(suggestion.address);
    expect(adapters.change).toHaveBeenLastCalledWith(
      suggestion.address,
      suggestion.placeId
    );
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await debounce();
    expect(adapters.post).toHaveBeenCalledOnce();
    expect(adapters.submit).not.toHaveBeenCalled();
    await edit("A different address");
    expect(adapters.change).toHaveBeenLastCalledWith(
      "A different address",
      undefined
    );
  });

  // retain input focus for touch-generated mouse selection
  it("selects a pointer option without submitting the form", async () => {
    await edit("Seattle");
    await debounce();
    const option = container.querySelector('[role="option"]')!;
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(() => {
      option.dispatchEvent(event);
      option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(event.defaultPrevented).toBe(true);
    expect(field().value).toBe(suggestion.address);
    expect(adapters.submit).not.toHaveBeenCalled();
  });

  // dismissing before the debounce expires must prevent the paid request itself
  it("cancels a pending request on escape", async () => {
    await edit("Seattle");
    await key("Escape");
    await debounce();
    expect(adapters.post).not.toHaveBeenCalled();
    expect(field().value).toBe("Seattle");
  });

  // discard late results after escape and blur
  it.each(["escape", "blur"])(
    "ignores in-flight responses after %s",
    async (dismissal) => {
      let resolve!: (value: typeof success) => void;
      adapters.post.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      );
      await edit("Seattle");
      await debounce();
      expect(adapters.post).toHaveBeenCalledOnce();
      // exercise each dismissal against its own unresolved network completion
      if (dismissal === "escape") {
        await key("Escape");
      } else {
        await act(() => field().blur());
      }
      await act(() => {
        resolve(success);
      });
      expect(container.querySelector('[role="listbox"]')).toBeNull();
    }
  );

  // never replace the newer query with a slower older completion
  it("ignores obsolete input results", async () => {
    let resolve!: (value: typeof success) => void;
    adapters.post.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    await edit("Old address");
    await debounce();
    await edit("New address");
    await debounce();
    await act(() => {
      resolve({
        available: true,
        suggestions: [{ ...suggestion, primaryText: "Old result" }],
      });
    });
    expect(container.textContent).not.toContain("Old result");
    expect(field().value).toBe("New address");
  });

  // preserve explicit manual entry if google is unavailable or there are no matches
  it.each([
    { available: false, suggestions: [] },
    { available: true, suggestions: [] },
  ])("supports manual entry with %j", async (result) => {
    adapters.post.mockResolvedValue(result);
    await edit("Manual address");
    await debounce();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.textContent).toMatch(/still enter/);
    expect((await key("Enter")).defaultPrevented).toBe(false);
    await act(() => {
      container.querySelector("button")!.click();
    });
    expect(adapters.submit).toHaveBeenCalledOnce();
  });

  // stop suggestions when the parent starts an explicit estimate
  it("cancels the debounce when disabled", async () => {
    await edit("Seattle");
    await act(() => {
      root.render(<Harness disabled />);
    });
    await debounce();
    expect(adapters.post).not.toHaveBeenCalled();
    expect(field().disabled).toBe(true);
  });

  // render prediction text as text rather than trusting provider html
  it("escapes provider text", async () => {
    adapters.post.mockResolvedValue({
      available: true,
      suggestions: [{ ...suggestion, primaryText: "<img onerror=alert(1)>" }],
    });
    await edit("Seattle");
    await debounce();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img onerror=alert(1)>");
  });
});

describe("address suggestion response boundary", () => {
  // do not retain raw provider bodies, identifiers or oversized response collections
  it.each([
    { ...success, raw: "private" },
    { available: true, suggestions: [{ ...suggestion, raw: "private" }] },
    {
      available: true,
      suggestions: [{ ...suggestion, placeId: "invalid\nidentifier" }],
    },
    { available: true, suggestions: Array(6).fill(suggestion) },
    { available: false, suggestions: [suggestion] },
  ])("rejects malformed payload %j", async (value) => {
    adapters.post.mockResolvedValue(value);
    expect(await getAddressSuggestions("Seattle")).toEqual({
      available: false,
      suggestions: [],
    });
  });

  // sanitize transport errors without exposing query or provider details
  it("returns a manual-entry fallback on transport failure", async () => {
    adapters.post.mockRejectedValue(new Error("private query and key"));
    expect(await getAddressSuggestions("Seattle")).toEqual({
      available: false,
      suggestions: [],
    });
  });
});
