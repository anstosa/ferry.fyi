import clsx from "clsx";
import React, { ReactElement } from "react";

interface LoadingWavesProps {
  className?: string;
  label?: string;
  svgClassName?: string;
}

// animated wave loader
export const LoadingWaves = ({
  className,
  label = "Loading",
  svgClassName,
}: LoadingWavesProps): ReactElement => {
  return (
    <div
      aria-label={label}
      className={clsx(
        "relative flex h-16 w-40 items-center justify-center",
        className
      )}
      role="status"
    >
      <svg
        aria-hidden="true"
        className={clsx("splash-loader-waves", svgClassName)}
        focusable="false"
        viewBox="0 0 160 48"
      >
        <path
          className="splash-loader-wave splash-loader-wave--back"
          d="M4 26 C18 14 34 14 48 26 S78 38 94 26 124 14 156 26"
        />
        <path
          className="splash-loader-wave splash-loader-wave--middle"
          d="M4 24 C20 10 36 10 52 24 S84 38 100 24 132 10 156 24"
        />
        <path
          className="splash-loader-wave splash-loader-wave--front"
          d="M4 29 C20 18 36 18 52 29 S84 40 100 29 132 18 156 29"
        />
      </svg>
    </div>
  );
};
