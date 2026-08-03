import clsx from "clsx";
import React, { type ReactElement } from "react";
import { Link } from "react-router-dom";
import { isEmpty } from "shared/lib/arrays";
import { getStaticPublicSsrTerminalSlug } from "shared/lib/ssrRouteMatch";

import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import {
  getRouteGroups,
  hasFavoriteRoute,
  sortRouteGroups,
} from "~/lib/routeGroups";
import GpsTargetIcon from "~/static/images/icons/solid/location.svg";
import StarFilledIcon from "~/static/images/icons/solid/star.svg";

const TERMINAL_LINK_CLASSES = clsx(
  "whitespace-nowrap",
  "block cursor-pointer",
  "px-1 py-2",
  "hover:bg-lighten-high",
  "flex items-center justify-center",
  "text-base sm:text-lg"
);

interface HomeDirectoryTerminal {
  id: string;
  name: string;
}

const getTerminalGridClasses = (columns = 2): string =>
  clsx("grid max-[299px]:grid-cols-1 border-t border-white border-opacity-20", {
    "grid-cols-2": columns === 2,
    "grid-cols-3": columns === 3,
  });

const TerminalLink = ({
  closestTerminal,
  terminal,
}: {
  closestTerminal: HomeDirectoryTerminal | null;
  terminal: HomeDirectoryTerminal;
}): ReactElement => {
  const className = clsx(TERMINAL_LINK_CLASSES, {
    "font-bold": terminal.id === closestTerminal?.id,
  });
  const content = (
    <>
      {terminal.id === closestTerminal?.id ? (
        <GpsTargetIcon aria-hidden="true" className="mr-3" />
      ) : null}
      {terminal.name}
    </>
  );
  const slug = getStaticPublicSsrTerminalSlug(terminal.id);
  return (
    <li>
      {slug ? (
        <Link className={className} to={`/${slug}`}>
          {content}
        </Link>
      ) : (
        <span className={className}>{content}</span>
      )}
    </li>
  );
};

export const HomeTerminalDirectory = ({
  closestTerminal = null,
  favoriteRouteIds = [],
  showLoadingState = false,
  terminals,
}: {
  closestTerminal?: HomeDirectoryTerminal | null;
  favoriteRouteIds?: string[];
  showLoadingState?: boolean;
  terminals: HomeDirectoryTerminal[];
}): ReactElement => {
  const routeGroups = sortRouteGroups(
    getRouteGroups(terminals),
    closestTerminal,
    favoriteRouteIds
  );

  return (
    <nav
      aria-label="Ferry terminals"
      className="w-full flex justify-center px-4 pb-8"
    >
      <div className="grid w-full max-w-6xl grid-cols-2 gap-x-4 gap-y-6">
        {showLoadingState && isEmpty(terminals) ? (
          <SkeletonGroup
            className="col-span-2 space-y-6"
            label="Loading ferry routes and terminals"
          >
            {[0, 1, 2].map((routeIndex) => (
              <section className="space-y-2" key={routeIndex}>
                <Skeleton className="mx-auto h-4 w-32" variant="text" />
                <div className={getTerminalGridClasses()}>
                  <Skeleton className="m-2 h-10" />
                  <Skeleton className="m-2 h-10" />
                </div>
              </section>
            ))}
          </SkeletonGroup>
        ) : null}
        {routeGroups.map((routeGroup) => (
          <section className="col-span-2 min-w-0" key={routeGroup.id}>
            <h2 className="px-4 pb-2 text-center text-sm font-extrabold uppercase tracking-[0.18em] text-[#fce580] drop-shadow-sm">
              <span className="inline-flex items-center gap-2">
                {hasFavoriteRoute(routeGroup, favoriteRouteIds) ? (
                  <span className="inline-flex items-center">
                    <StarFilledIcon aria-hidden="true" className="h-3 w-3" />
                    <span className="sr-only">Contains a favorite route</span>
                  </span>
                ) : null}
                {routeGroup.label}
              </span>
            </h2>
            <ul className={getTerminalGridClasses(routeGroup.terminalColumns)}>
              {routeGroup.terminals.map((terminal) => (
                <TerminalLink
                  closestTerminal={closestTerminal}
                  terminal={terminal}
                  key={`${routeGroup.id}:${terminal.id}`}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
};
