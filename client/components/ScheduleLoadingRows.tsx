import clsx from "clsx";
import React, { type ReactElement } from "react";

import { Skeleton, SkeletonGroup } from "./Skeleton";

interface Props {
  className?: string;
  label: string;
  showPastSailings?: boolean;
}

// mirror four compact completed sailings followed by full-height upcoming sailings
export const ScheduleLoadingRows = ({
  className,
  label,
  showPastSailings = true,
}: Props): ReactElement => (
  <SkeletonGroup className={clsx("space-y-2 p-2", className)} label={label}>
    {/* retain the compact history shape only for current service days */}
    {showPastSailings ? (
      <div className="-mx-2 border-t border-black/10 dark:border-white/10">
        {/* only the recorded delay and right-aligned time are unknown */}
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="flex h-7 items-center gap-3 border-b border-black/10 px-4 dark:border-white/10"
            data-loading-past-sailing
            key={index}
          >
            <Skeleton className="h-3 w-16" variant="text" />
            <Skeleton className="ml-auto h-4 w-24" variant="text" />
          </div>
        ))}
      </div>
    ) : null}
    {/* upcoming sailings retain the expanded card proportions */}
    {Array.from({ length: 4 }, (_, index) => (
      <div className="relative h-24 bg-white dark:bg-gray-darkest" key={index}>
        <Skeleton className="absolute right-3 top-3 h-10 w-10" />
        <Skeleton
          className="absolute bottom-3 left-3 h-3 w-2/5"
          variant="text"
        />
      </div>
    ))}
  </SkeletonGroup>
);
