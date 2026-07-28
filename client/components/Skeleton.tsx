import clsx from "clsx";
import React, {
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

type SkeletonVariant = "block" | "circle" | "text";

interface SkeletonProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "aria-hidden"
> {
  variant?: SkeletonVariant;
}

interface SkeletonGroupProps extends HTMLAttributes<HTMLDivElement> {
  busy?: boolean;
  children: ReactNode;
  label: string;
}

/** Decorative loading shape. Wrap related shapes in SkeletonGroup for one announcement. */
export const Skeleton = ({
  className,
  variant = "block",
  ...props
}: SkeletonProps): ReactElement => {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={clsx("skeleton", `skeleton--${variant}`, className)}
    />
  );
};

/** Announces a related set of decorative loading shapes as one busy region. */
export const SkeletonGroup = ({
  busy = true,
  children,
  className,
  label,
  ...props
}: SkeletonGroupProps): ReactElement => {
  return (
    <div
      {...props}
      aria-busy={busy}
      aria-label={label}
      aria-live="polite"
      className={clsx("skeleton-group", className)}
      role="status"
    >
      {children}
    </div>
  );
};
