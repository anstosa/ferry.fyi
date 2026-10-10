import React, { type ReactElement } from "react";

import { useAppRenderContext } from "~/lib/renderContext";
import { getRouteLoadingContext } from "~/lib/routeLoadingContext";

import { RouteLoadingState } from "./RouteLoadingState";
import { Skeleton, SkeletonGroup } from "./Skeleton";

// show known route content before the top-level route bundle finishes loading
export const AppLoadingState = ({
  pathname = "",
  search = "",
}: {
  pathname?: string;
  search?: string;
}): ReactElement => {
  const { clock } = useAppRenderContext();
  const context = getRouteLoadingContext(pathname, search, clock());
  // unrelated pages retain their existing bootstrap boundary
  if (context) {
    return <RouteLoadingState context={context} view={context.view} />;
  }
  return (
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
};
