import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";

import { useAppRenderContext } from "~/lib/renderContext";
import type { RouteLoadingContext } from "~/lib/routeLoadingContext";
import type { RouteView } from "~/lib/routeViews";
import { getPlainTerminalContent } from "~/lib/terminalOverview";
import MenuIcon from "~/static/images/icons/solid/bars.svg";

import { AlertsLoadingContent } from "./AlertsLoadingContent";
import { CameraOverview } from "./CameraOverview";
import { FareLoadingContent } from "./FareLoadingContent";
import { NavigationFormSkeleton } from "./NavigationFormSkeleton";
import { RoutePageIntro } from "./RoutePageIntro";
import { RoutePlanningLinks } from "./RoutePlanningLinks";
import { ScheduleLoadingRows } from "./ScheduleLoadingRows";
import { ScheduleOverview } from "./ScheduleOverview";
import { Skeleton, SkeletonGroup } from "./Skeleton";
import { TerminalOverview } from "./TerminalOverview";

interface Props {
  context?: RouteLoadingContext;
  hasRouteFooter?: boolean;
  view: RouteView;
}

// header labels and menu artwork are known even while a route module resolves
const RouteLoadingHeader = ({
  context,
}: Pick<Props, "context">): ReactElement => (
  <>
    {/* reserve native top inset */}
    <div className="h-safe-top flex-shrink-0 bg-green-dark dark:bg-blue-dark" />
    {/* retain the full header height above long pending page content */}
    <header className="flex h-16 shrink-0 items-center gap-3 bg-green-dark px-4 dark:bg-blue-dark">
      <button
        aria-label="Open menu"
        disabled
        type="button"
        className="h-8 w-8 shrink-0"
      >
        <MenuIcon aria-hidden="true" className="h-6 w-6" />
      </button>
      <span className="mx-auto truncate font-semibold text-white">
        {context?.terminal.name ?? "Ferry FYI"}
        {context?.mate && context.view !== "terminal"
          ? ` → ${context.mate.name}`
          : ""}
      </span>
    </header>
  </>
);

// keep the static shell outside source-owned busy regions
const PageShell = ({
  children,
  context,
  hasRouteFooter = false,
}: {
  children: ReactElement;
  context?: RouteLoadingContext;
  hasRouteFooter?: boolean;
}): ReactElement => (
  <div className="flex h-full min-h-0 flex-grow flex-col bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
    <RouteLoadingHeader context={context} />
    <main
      className={`min-h-0 flex-grow overflow-y-auto ${hasRouteFooter ? "pb-safe-bottom" : ""}`}
    >
      {children}
    </main>
  </div>
);

// share the real wait-first introduction instead of skeletonizing its known labels
const ScheduleLoadingState = ({
  context,
  hasRouteFooter,
}: Props): ReactElement => {
  const { clock } = useAppRenderContext();
  const now = clock();
  return (
    <PageShell context={context} hasRouteFooter={hasRouteFooter}>
      <div className="mx-auto w-full max-w-6xl bg-white dark:bg-black">
        {context?.mate ? (
          <ScheduleOverview
            mate={{
              ...context.mate,
              bulletins: context.mate.bulletins ?? [],
              waitTimes: context.mate.waitTimes ?? [],
            }}
            terminal={{
              ...context.terminal,
              bulletins: context.terminal.bulletins ?? [],
              waitTimes: context.terminal.waitTimes ?? [],
            }}
            selectedDate={context.selectedDate}
            time={DateTime.fromMillis(now, { zone: "America/Los_Angeles" })}
            reportsLoading={!context.terminal.bulletins}
            scheduleLoading
            schedule={null}
          />
        ) : (
          <div className="p-4">
            <RoutePageIntro title="Ferry schedules & wait times" />
          </div>
        )}
        <ScheduleLoadingRows
          label="Loading route schedule"
          showPastSailings={
            !context ||
            context.selectedDate === getRecommendationServiceDate(now / 1000)
          }
        />
      </div>
    </PageShell>
  );
};

// retain the default fare categories and the functional first calculator step
const FareLoadingState = ({ context, hasRouteFooter }: Props): ReactElement => {
  const { clock } = useAppRenderContext();
  return (
    <PageShell context={context} hasRouteFooter={hasRouteFooter}>
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
        <FareLoadingContent
          departingName={context?.terminal.name ?? "Departure terminal"}
          arrivingName={context?.mate?.name ?? "Arrival terminal"}
          tripDate={
            context?.selectedDate ??
            getRecommendationServiceDate(clock() / 1000)
          }
          mate={context?.mate}
          terminal={context?.terminal}
        />
      </div>
    </PageShell>
  );
};

// camera names and inventory stay visible when only their images are unresolved
const CamerasLoadingState = ({
  context,
  hasRouteFooter,
}: Props): ReactElement => {
  const cameras = context?.terminal.cameras;
  return (
    <PageShell context={context} hasRouteFooter={hasRouteFooter}>
      <div>
        <CameraOverview
          loading={!cameras}
          mate={context?.mate}
          terminal={{
            ...(context?.terminal ?? { id: "", name: "", abbreviation: "" }),
            cameras: cameras ?? [],
          }}
        />
        <div className="mx-auto w-full max-w-6xl space-y-8 py-6 pl-16 pr-4">
          {/* use known dimensions and labels without inventing a camera inventory */}
          {(cameras ?? [null, null]).map((camera, index) => (
            <div className="w-full max-w-[480px]" key={camera?.id ?? index}>
              <SkeletonGroup
                label={
                  camera
                    ? `Loading ${camera.title} camera image`
                    : "Loading camera images"
                }
              >
                <Skeleton
                  className="w-full rounded-none"
                  style={{
                    aspectRatio: camera
                      ? `${camera.image.width} / ${camera.image.height}`
                      : "16 / 9",
                  }}
                />
              </SkeletonGroup>
              {camera ? (
                <h2 className="mt-3 min-h-9 text-lg font-bold">
                  {camera.title}
                </h2>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
};

// share the unboxed terminal guide with placeholders only for unknown WSF facts
const TerminalLoadingState = ({
  context,
  hasRouteFooter,
}: Props): ReactElement => (
  <PageShell context={context} hasRouteFooter={hasRouteFooter}>
    <div className="mx-auto w-full max-w-6xl p-4 pb-8">
      <TerminalOverview
        loading={!context?.terminal.info}
        mate={context?.mate}
        terminal={
          context?.terminal
            ? {
                ...context.terminal,
                ...getPlainTerminalContent(context.terminal),
              }
            : { id: "", name: "", abbreviation: "" }
        }
      />
    </div>
  </PageShell>
);

// keep navigation copy visible while its schedule-dependent form resolves
const NavigationLoadingState = ({
  context,
  hasRouteFooter,
}: Props): ReactElement => (
  <PageShell context={context} hasRouteFooter={hasRouteFooter}>
    <section className="mx-auto w-full max-w-6xl p-4">
      <RoutePageIntro
        title="What boat will I make?"
        description="If you leave now, estimate arrival and your earliest likely sailing."
      />
      <RoutePlanningLinks
        currentView="navigation"
        mate={context?.mate}
        terminal={context?.terminal}
      />
      <div className="mx-auto w-full max-w-2xl">
        <NavigationFormSkeleton />
      </div>
    </section>
  </PageShell>
);

// announce only the unresolved map surface
const MapLoadingState = ({ context, hasRouteFooter }: Props): ReactElement => (
  <PageShell context={context} hasRouteFooter={hasRouteFooter}>
    <SkeletonGroup className="h-full" label="Loading route map">
      <Skeleton className="h-full w-full rounded-none" />
    </SkeletonGroup>
  </PageShell>
);

const skeletonCardClasses =
  "rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white shadow-sm dark:border-[rgba(255,255,255,0.08)] dark:bg-[#00202a]";

// keep route guidance and planning links visible while only alerts resolve
const AlertsLoadingState = ({
  context,
  hasRouteFooter,
}: Props): ReactElement => (
  <PageShell context={context} hasRouteFooter={hasRouteFooter}>
    <AlertsLoadingContent
      mate={context?.mate}
      selectedDate={context?.selectedDate}
      terminal={context?.terminal}
    />
  </PageShell>
);

// preserve the account-dependent subscription loading region
const SubscribeLoadingState = ({
  context,
  hasRouteFooter,
}: Props): ReactElement => (
  <PageShell context={context} hasRouteFooter={hasRouteFooter}>
    <SkeletonGroup
      label="Loading route subscriptions"
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 pb-24 sm:px-6"
    >
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
    </SkeletonGroup>
  </PageShell>
);

const loadingContent: Record<RouteView, (props: Props) => ReactElement> = {
  alerts: AlertsLoadingState,
  cameras: CamerasLoadingState,
  fare: FareLoadingState,
  map: MapLoadingState,
  navigation: NavigationLoadingState,
  schedule: ScheduleLoadingState,
  subscribe: SubscribeLoadingState,
  terminal: TerminalLoadingState,
};

// dated live-only pages need no data placeholders or trip controls
const TodayOnlyLoadingState = ({
  context,
  hasRouteFooter,
  view,
}: Props): ReactElement => {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  query.delete("date");
  return (
    <PageShell context={context} hasRouteFooter={hasRouteFooter}>
      <div className="flex h-full items-center justify-center px-8 text-center">
        <p className="text-lg">
          <Link
            className="link text-green-dark dark:text-green-light"
            to={{
              pathname: location.pathname,
              search: query.toString(),
              hash: location.hash,
            }}
          >
            Go to today
          </Link>{" "}
          to view {view === "navigation" ? "leave-now estimates" : view}
        </p>
      </div>
    </PageShell>
  );
};

// limit loading placeholders to source-owned regions inside real route content
export const RouteLoadingState = ({
  context,
  hasRouteFooter = false,
  view,
}: Props): ReactElement => {
  const { clock } = useAppRenderContext();
  // current-only features cannot fetch or estimate an historical service day
  if (
    context &&
    context.selectedDate !== getRecommendationServiceDate(clock() / 1000) &&
    ["cameras", "map", "alerts", "navigation"].includes(view)
  ) {
    return (
      <TodayOnlyLoadingState
        context={context}
        hasRouteFooter={hasRouteFooter}
        view={view}
      />
    );
  }
  const Content = loadingContent[view];

  return (
    <div
      className="flex h-full min-h-0 flex-grow flex-col"
      data-route-loading={view}
    >
      <Content context={context} hasRouteFooter={hasRouteFooter} view={view} />
    </div>
  );
};
