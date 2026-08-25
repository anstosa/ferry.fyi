import clsx from "clsx";
import React, { type ReactElement } from "react";

interface Props {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

/** Renders one accessible binary preference switch. */
export const ToggleSwitch = ({
  checked,
  className,
  disabled = false,
  label,
  onChange,
}: Props): ReactElement => (
  <button
    aria-checked={checked}
    aria-label={label}
    className={clsx(
      "relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-dark dark:focus-visible:outline-green-light",
      checked
        ? "bg-green-dark dark:bg-green-light"
        : "bg-gray-300 dark:bg-white/20",
      className
    )}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    role="switch"
    type="button"
  >
    <span
      className={clsx(
        "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition",
        checked ? "left-6" : "left-1"
      )}
    />
  </button>
);
