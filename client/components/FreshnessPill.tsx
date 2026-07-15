import clsx from "clsx";
import React, {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  useEffect,
  useState,
} from "react";

import { formatUpdatedAt } from "../../shared/lib/freshness";

interface FreshnessPillBaseProps {
  className?: string;
  now?: number;
  sourceUpdatedAt: number | null;
}

interface FreshnessPillButtonProps
  extends
    FreshnessPillBaseProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick"> {
  isRefreshing?: boolean;
  onClick: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
}

interface FreshnessPillStatusProps
  extends
    FreshnessPillBaseProps,
    Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  isRefreshing?: never;
  onClick?: never;
}

export type FreshnessPillProps =
  | FreshnessPillButtonProps
  | FreshnessPillStatusProps;

const baseClassName =
  "inline-flex w-fit items-center rounded-full border px-2 py-1 text-2xs font-bold " +
  "border-black bg-white text-black dark:border-white dark:bg-black dark:text-white";

/**
 * Shows the age of source data, optionally as a refresh action.
 */
export const FreshnessPill = (
  props: FreshnessPillProps
): ReactElement | null => {
  const { className, now: fixedNow, sourceUpdatedAt, ...elementProps } = props;
  const [currentNow, setCurrentNow] = useState(() => Date.now() / 1000);
  const now = fixedNow ?? currentNow;
  const label = formatUpdatedAt(sourceUpdatedAt, now);
  const classes = clsx(baseClassName, className);

  useEffect(() => {
    if (fixedNow !== undefined) {
      return undefined;
    }

    const updateClock = (): void => setCurrentNow(Date.now() / 1000);
    const delay = 60_000 - (Date.now() % 60_000);
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      updateClock();
      interval = window.setInterval(updateClock, 60_000);
    }, delay);

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, [fixedNow]);

  if (!label) {
    return null;
  }

  if ("onClick" in elementProps && elementProps.onClick) {
    const { isRefreshing = false, onClick, ...buttonProps } = elementProps;

    return (
      <button
        {...buttonProps}
        aria-busy={isRefreshing}
        aria-label={`Refresh data. ${label}`}
        className={classes}
        disabled={isRefreshing || buttonProps.disabled}
        onClick={onClick}
        type="button"
      >
        {isRefreshing ? "Refreshing…" : label}
      </button>
    );
  }

  return (
    <span
      {...elementProps}
      aria-label={label}
      className={classes}
      role="status"
    >
      {label}
    </span>
  );
};
