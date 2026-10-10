import React, { type ReactElement } from "react";

import { Skeleton, SkeletonGroup } from "./Skeleton";

// mirror the travel choices, buffer and two origin actions while sailings load
export const NavigationFormSkeleton = (): ReactElement => (
  <SkeletonGroup
    className="mt-5"
    data-navigation-form-loading
    label="Loading navigation"
  >
    <p className="text-sm font-semibold">Travel method</p>
    <div className="mt-2 grid grid-cols-4 gap-2">
      {/* preserve the four equally sized travel method buttons */}
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton className="min-h-24 w-full rounded-xl" key={index} />
      ))}
    </div>
    <div className="mt-4 space-y-2">
      <p className="text-sm font-semibold">Safety buffer</p>
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
    <Skeleton className="mt-4 h-12 w-full rounded-lg" />
    <div
      aria-hidden
      className="mt-5 flex items-center gap-3 text-xs font-medium text-gray-dark dark:text-gray-light"
    >
      <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
      <span>or</span>
      <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
    </div>
    <div className="mt-4 space-y-3">
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-lg" />
    </div>
  </SkeletonGroup>
);
