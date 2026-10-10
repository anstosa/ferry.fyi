// @vitest-environment jsdom

import { DateTime } from "luxon";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DateButton } from "../../client/components/DateButton";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

// mount or update one date button in a stable root
const renderDateButton = async (element: React.ReactElement) => {
  let container = document.querySelector<HTMLDivElement>("#date-button-test");
  // create the shared test root once
  if (!container) {
    container = document.createElement("div");
    container.id = "date-button-test";
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root?.render(element);
    await Promise.resolve();
  });
  return container;
};

describe("DateButton", () => {
  // controlled prop synchronization
  it("uses supplied date updates without notifying on mount or prop sync", async () => {
    const onDateChange = vi.fn();
    const firstDate = DateTime.fromISO("2026-07-18");
    const nextDate = DateTime.fromISO("2026-07-19");
    const container = await renderDateButton(
      <DateButton defaultDate={firstDate} onDateChange={onDateChange} />
    );

    expect(
      container.querySelectorAll('[aria-label="Set Date"] > span')[1]
        ?.textContent
    ).toBe("18");
    expect(onDateChange).not.toHaveBeenCalled();

    await renderDateButton(
      <DateButton defaultDate={nextDate} onDateChange={onDateChange} />
    );

    expect(
      container.querySelectorAll('[aria-label="Set Date"] > span')[1]
        ?.textContent
    ).toBe("19");
    expect(onDateChange).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="Set Date"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const selectedDate = container.querySelector(
      '[role="gridcell"][aria-selected="true"] button'
    );
    expect(selectedDate?.getAttribute("aria-label")).toContain(
      "July 19th, 2026"
    );
    expect(onDateChange).not.toHaveBeenCalled();
  });

  // user selection notification
  it("notifies exactly once when the user selects a day", async () => {
    const onDateChange = vi.fn<(date: DateTime) => void>();
    // update the controlled value in response to a genuine selection
    const Harness = (): React.ReactElement => {
      const [date, setDate] = useState(DateTime.fromISO("2026-07-18"));
      return (
        <DateButton
          defaultDate={date}
          onDateChange={(nextDate) => {
            onDateChange(nextDate);
            setDate(nextDate);
          }}
        />
      );
    };
    const container = await renderDateButton(<Harness />);

    await act(async () => {
      container
        .querySelector<HTMLElement>('[aria-label="Set Date"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const dayButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Monday, July 20th, 2026"]'
    );
    expect(dayButton).not.toBeNull();
    expect(dayButton?.disabled).toBe(false);

    await act(async () => {
      dayButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onDateChange).toHaveBeenCalledTimes(1);
    expect(onDateChange.mock.calls[0]?.[0].toISODate()).toBe("2026-07-20");
    expect(
      container.querySelectorAll('[aria-label="Set Date"] > span')[1]
        ?.textContent
    ).toBe("20");
  });
});
