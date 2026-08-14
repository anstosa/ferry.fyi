import React, { type ReactElement } from "react";

import type { RouteView } from "~/lib/routeViews";

import { ScheduleLoadingRows } from "./ScheduleLoadingRows";
import { Skeleton, SkeletonGroup } from "./Skeleton";

interface Props {
  hasRouteFooter?: boolean;
  view: RouteView;
}

const routeLoadingLabels: Record<RouteView, string> = {
  alerts: "Loading route alerts",
  cameras: "Loading route cameras",
  fare: "Loading route fares",
  map: "Loading route map",
  schedule: "Loading route schedule",
  subscribe: "Loading route subscriptions",
  terminal: "Loading terminal details",
};

const RouteHeaderSkeleton = (): ReactElement => (
  <>
    {/* reserve native top inset */}
    <div className="h-safe-top flex-shrink-0 bg-green-dark dark:bg-blue-dark" />
    <header className="flex h-16 items-center gap-3 bg-green-dark px-4 dark:bg-blue-dark">
      <Skeleton className="h-8 w-8 shrink-0 bg-white/20" variant="circle" />
      <Skeleton className="mx-auto h-7 w-40 max-w-[45%] bg-white/20" />
      <Skeleton className="h-10 w-10 shrink-0 bg-white/20" />
    </header>
  </>
);

const PageShell = ({
  children,
  hasRouteFooter = false,
}: {
  children: ReactElement;
  hasRouteFooter?: boolean;
}): ReactElement => (
  <main
    className={
      hasRouteFooter
        ? "flex min-h-[calc(100vh-4rem-var(--safe-area-inset-bottom))] flex-col bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]"
        : "flex min-h-screen flex-col bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]"
    }
  >
    <RouteHeaderSkeleton />
    {children}
  </main>
);

const ScheduleLoadingState = ({ hasRouteFooter }: Props): ReactElement => (
  <PageShell hasRouteFooter={hasRouteFooter}>
    <ScheduleLoadingRows
      className={
        hasRouteFooter
          ? "h-[calc(100vh-8rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))]"
          : "h-[calc(100vh-4rem-var(--safe-area-inset-top))]"
      }
      label="Loading route schedule"
    />
  </PageShell>
);

const FareLoadingState = ({ hasRouteFooter }: Props): ReactElement => (
  <PageShell hasRouteFooter={hasRouteFooter}>
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-blue-dark">
        <Skeleton className="h-7 w-40" variant="text" />
        <Skeleton className="mt-3 h-4 w-3/4" variant="text" />
        <Skeleton className="mt-6 h-5 w-44" variant="text" />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((index) => (
            <Skeleton className="h-32 w-full" key={index} />
          ))}
        </div>
        <Skeleton className="mt-6 h-5 w-36" variant="text" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </section>
      <section className="rounded-2xl bg-white p-5 dark:bg-blue-dark">
        <Skeleton className="h-6 w-36" variant="text" />
        <Skeleton className="mt-4 h-10 w-1/3" variant="text" />
      </section>
    </div>
  </PageShell>
);

const CamerasLoadingState = ({ hasRouteFooter }: Props): ReactElement => (
  <PageShell hasRouteFooter={hasRouteFooter}>
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:pl-16">
      {[0, 1].map((index) => (
        <div className="w-full max-w-[480px]" key={index}>
          <Skeleton className="h-[300px] w-full" />
          <div className="space-y-2 px-1 pt-3">
            <Skeleton className="h-6 w-2/3" variant="text" />
            <Skeleton className="h-4 w-1/2" variant="text" />
          </div>
        </div>
      ))}
    </div>
  </PageShell>
);

const TerminalLoadingState = ({ hasRouteFooter }: Props): ReactElement => (
  <PageShell hasRouteFooter={hasRouteFooter}>
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 pb-8">
      <section>
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 shrink-0" variant="circle" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-2/3" variant="text" />
            <Skeleton className="h-4 w-1/2" variant="text" />
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <Skeleton className="h-4 w-full" variant="text" />
          <Skeleton className="h-4 w-3/4" variant="text" />
        </div>
        <div className="mt-5 flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
      </section>
      <section>
        <Skeleton className="mb-3 h-6 w-32" variant="text" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </section>
    </div>
  </PageShell>
);

const MapLoadingState = ({ hasRouteFooter }: Props): ReactElement => (
  <PageShell hasRouteFooter={hasRouteFooter}>
    <Skeleton
      className={
        hasRouteFooter
          ? "h-[calc(100vh-8rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))] w-full flex-grow rounded-none"
          : "h-[calc(100vh-4rem-var(--safe-area-inset-top))] w-full flex-grow rounded-none"
      }
    />
  </PageShell>
);

const skeletonCardClasses =
  "rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]";

const AlertsLoadingState = ({ hasRouteFooter }: Props): ReactElement => (
  <PageShell hasRouteFooter={hasRouteFooter}>
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6">
      <section className="rounded-2xl bg-[#016f52] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Skeleton
            className="h-11 w-11 shrink-0 bg-white/20"
            variant="circle"
          />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24 bg-white/20" variant="text" />
            <Skeleton className="h-8 w-2/3 bg-white/20" variant="text" />
            <Skeleton className="h-4 w-1/2 bg-white/20" variant="text" />
          </div>
        </div>
      </section>
      {[0, 1].map((index) => (
        <section
          className="space-y-3 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5 dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]"
          key={index}
        >
          <Skeleton className="h-5 w-28" variant="text" />
          <Skeleton className="h-6 w-3/4" variant="text" />
          <Skeleton className="h-4 w-full" variant="text" />
          <Skeleton className="h-4 w-5/6" variant="text" />
        </section>
      ))}
    </div>
  </PageShell>
);

const SubscribeLoadingState = ({ hasRouteFooter }: Props): ReactElement => (
  <PageShell hasRouteFooter={hasRouteFooter}>
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 pb-24 sm:px-6">
      <section className={`${skeletonCardClasses} p-5`}>
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 shrink-0" variant="circle" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-24" variant="text" />
            <Skeleton className="h-8 w-3/5" variant="text" />
            <Skeleton className="h-4 w-full" variant="text" />
          </div>
        </div>
      </section>
      <section className={`${skeletonCardClasses} p-4`}>
        <Skeleton className="h-6 w-32" variant="text" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </section>
      <section className={`${skeletonCardClasses} p-4`}>
        <Skeleton className="h-6 w-36" variant="text" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </section>
    </div>
  </PageShell>
);

const loadingContent: Record<RouteView, (props: Props) => ReactElement> = {
  alerts: AlertsLoadingState,
  cameras: CamerasLoadingState,
  fare: FareLoadingState,
  map: MapLoadingState,
  schedule: ScheduleLoadingState,
  subscribe: SubscribeLoadingState,
  terminal: TerminalLoadingState,
};

/** Layout-specific placeholder while a Route tab's lazy view is loading. */
export const RouteLoadingState = ({
  hasRouteFooter = false,
  view,
}: Props): ReactElement => {
  const Content = loadingContent[view];

  return (
    <SkeletonGroup className="flex-grow" label={routeLoadingLabels[view]}>
      <Content hasRouteFooter={hasRouteFooter} view={view} />
    </SkeletonGroup>
  );
};
