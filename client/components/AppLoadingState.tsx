import React, { type ReactElement } from "react";

import { Skeleton, SkeletonGroup } from "./Skeleton";

/** Generic app shell used while a top-level lazy page module is resolving. */
export const AppLoadingState = (): ReactElement => (
  <main className="min-h-screen bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
    <SkeletonGroup label="Loading page">
      <header className="flex h-16 items-center bg-green-dark px-4 dark:bg-blue-dark">
        <Skeleton className="h-8 w-8 bg-white/20" variant="circle" />
        <Skeleton className="mx-auto h-6 w-32 bg-white/20" variant="text" />
      </header>
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
        <Skeleton className="h-8 w-2/5" variant="text" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </SkeletonGroup>
  </main>
);
