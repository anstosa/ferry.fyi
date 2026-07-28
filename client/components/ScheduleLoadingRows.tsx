import clsx from "clsx";
import React, { type ReactElement } from "react";

import { Skeleton, SkeletonGroup } from "./Skeleton";

interface Props {
  className?: string;
  label: string;
}

/** Compact sailing rows that fill the viewport without imitating card borders. */
export const ScheduleLoadingRows = ({
  className,
  label,
}: Props): ReactElement => (
  <SkeletonGroup
    className={clsx(
      "grid auto-rows-[minmax(4rem,1fr)] gap-px overflow-hidden p-1",
      className
    )}
    label={label}
  >
    {Array.from({ length: 16 }, (_, index) => (
      <div
        className="relative min-h-0 bg-white dark:bg-gray-darkest"
        key={index}
      >
        <Skeleton className="absolute right-3 top-3 h-10 w-10" />
        <Skeleton
          className="absolute bottom-3 left-3 h-3 w-2/5"
          variant="text"
        />
      </div>
    ))}
  </SkeletonGroup>
);
