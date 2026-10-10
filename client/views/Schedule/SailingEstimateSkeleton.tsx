import clsx from "clsx";
import React from "react";

import { Skeleton, SkeletonGroup } from "~/components/Skeleton";

// reserve the arrival and three-sailing layout throughout the explicit estimate
export const SailingEstimateSkeleton = (): React.ReactElement => (
  <SkeletonGroup className="mt-5" label="Estimating your trip">
    <div className="grid grid-cols-3 items-center justify-items-center gap-x-2">
      <Skeleton className="col-span-3 h-3 w-44" variant="text" />
      <Skeleton
        className="col-start-2 row-start-2 mt-1 h-10 w-32 max-w-full"
        variant="text"
      />
      <Skeleton className="col-start-3 row-start-2 mt-1 h-11 w-11 rounded-lg" />
      <Skeleton
        className="col-span-3 row-start-3 mt-1 h-3 w-32"
        variant="text"
      />
    </div>
    <div className="mt-5 grid grid-cols-3 gap-2">
      {[0, 1, 2].map((index) => (
        // emphasize the same central sailing as the resolved results
        <div
          data-sailing-estimate-placeholder
          className={clsx(
            "flex flex-col items-center gap-3 rounded-xl border px-1 py-3 sm:px-3",
            index === 1 &&
              "border-green-dark/20 bg-green-lightest dark:border-green-light/25 dark:bg-green-dark/20",
            index !== 1 && "border-transparent"
          )}
          key={index}
        >
          <Skeleton className="h-3 w-14 max-w-full" variant="text" />
          <Skeleton
            className={clsx("w-20 max-w-full", index === 1 ? "h-7" : "h-6")}
            variant="text"
          />
          <Skeleton className="h-3 w-24 max-w-full" variant="text" />
          <Skeleton className="my-2 h-5 w-12" variant="text" />
        </div>
      ))}
    </div>
    <div
      className="mt-4 overflow-hidden rounded-lg"
      data-estimate-timeline-placeholder
    >
      <Skeleton className="w-full" style={{ height: 256 }} />
    </div>
  </SkeletonGroup>
);
