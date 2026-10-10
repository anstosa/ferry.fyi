import React, { type ReactElement } from "react";

import {
  AlertsOverview,
  type AlertsTerminal,
} from "~/components/AlertsOverview";
import { RoutePageIntro } from "~/components/RoutePageIntro";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";

// reserve only the unresolved provider-owned alert rows
export const AlertsResultsSkeleton = (): ReactElement => (
  <SkeletonGroup className="mt-3" label="Loading route alerts">
    {[0, 1].map((index) => (
      // match the compact unboxed alert rows
      <div
        className="space-y-2 border-b border-black/10 py-4 last:border-b-0 dark:border-white/10"
        data-loading-alert={index}
        key={index}
      >
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-24" variant="text" />
          <Skeleton className="h-5 w-20" variant="text" />
        </div>
        <Skeleton className="h-6 w-3/4" variant="text" />
        <Skeleton className="h-4 w-full" variant="text" />
      </div>
    ))}
  </SkeletonGroup>
);

// keep known alert guidance and route links outside the busy region
export const AlertsLoadingContent = ({
  mate,
  selectedDate,
  terminal,
}: {
  mate?: Pick<AlertsTerminal, "id" | "name"> | null;
  selectedDate?: string;
  terminal?: AlertsTerminal;
}): ReactElement => (
  <section className="mx-auto w-full max-w-6xl">
    {terminal ? (
      <AlertsOverview
        mate={mate}
        selectedDate={selectedDate}
        terminal={terminal}
      />
    ) : (
      <section className="border-b border-black/10 p-4 dark:border-white/10">
        <RoutePageIntro
          title="WSF service alerts"
          description="Check current Washington State Ferries service changes, delays and cancellations before you travel."
        />
      </section>
    )}
    <div className="p-4">
      <h2 className="text-lg font-bold">Service alerts</h2>
      <AlertsResultsSkeleton />
    </div>
  </section>
);
