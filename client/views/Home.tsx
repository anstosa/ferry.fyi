import clsx from "clsx";
import React, { ReactElement, useState } from "react";
import { Link } from "react-router-dom";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { isEmpty } from "shared/lib/arrays";
import { getSeoMetadata } from "shared/lib/seo";

import { HomeHero } from "~/components/HomeHero";
import { SeoHelmet } from "~/components/SeoHelmet";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
import { useFavoriteRoutes } from "~/lib/favoriteRoutes";
import { useFeatureFlags } from "~/lib/featureFlags";
import { useAppRenderContext } from "~/lib/renderContext";
import {
  getRouteGroups,
  hasFavoriteRoute,
  sortRouteGroups,
} from "~/lib/routeGroups";
import { getSlug, useTerminals } from "~/lib/terminals";
import MenuIcon from "~/static/images/icons/solid/bars.svg";
import GpsTargetIcon from "~/static/images/icons/solid/location.svg";
import StarFilledIcon from "~/static/images/icons/solid/star.svg";
import TicketIcon from "~/static/images/icons/solid/ticket.svg";
import TrophyIcon from "~/static/images/icons/solid/trophy.svg";
import { Menu } from "~/views/Menu";

import { Today } from "./Today";

const LI_CLASSES = clsx(
  "whitespace-nowrap",
  "block cursor-pointer",
  "px-1 py-2",
  "hover:bg-lighten-high",
  "flex items-center justify-center",
  "text-base sm:text-lg"
);

interface TerminalProps {
  closestTerminal: TerminalClass | null;
  terminal: TerminalClass;
}

// terminal column classes
const getTerminalGridClasses = (columns = 2): string =>
  clsx("grid max-[299px]:grid-cols-1 border-t border-white border-opacity-20", {
    "grid-cols-2": columns === 2,
    "grid-cols-3": columns === 3,
  });

// terminal route link
export const Terminal = ({
  closestTerminal,
  terminal,
}: TerminalProps): ReactElement => {
  const { name, id } = terminal;

  return (
    <li>
      <Link
        className={clsx(LI_CLASSES, {
          "font-bold": id === closestTerminal?.id,
        })}
        to={`/${getSlug(id)}`}
      >
        {id === closestTerminal?.id && <GpsTargetIcon className="mr-3" />}
        {name}
      </Link>
    </li>
  );
};

// homepage route groups
export const Home = (): ReactElement => {
  // alternate host guard
  const { seoHost } = useAppRenderContext();
  if (seoHost === "howmanyboats.today") {
    return <Today />;
  }
  const { terminals, closestTerminal } = useTerminals();
  const [favoriteRouteIds] = useFavoriteRoutes();
  const [isMenuOpen, setMenuOpen] = useState(false);
  const { leaderboardsEnabled } = useFeatureFlags();
  const routeGroups = sortRouteGroups(
    getRouteGroups(terminals),
    closestTerminal,
    favoriteRouteIds
  );
  return (
    <main className="relative min-h-screen min-h-[100dvh] overflow-y-scroll scrolling-touch bg-ferry-gradient text-white">
      <SeoHelmet seo={getSeoMetadata("/")} />
      <Menu
        hasTopBanner={false}
        isOpen={isMenuOpen}
        onClose={() => setMenuOpen(false)}
        onOpen={() => setMenuOpen(true)}
      />
      <button
        aria-label="Open Menu"
        className="absolute top-0 left-0 z-20 mt-safe-top p-4 text-2xl hover:bg-lighten-high"
        onClick={() => setMenuOpen(true)}
        type="button"
      >
        <MenuIcon />
      </button>
      <HomeHero
        leaderboardIcon={<TrophyIcon aria-hidden className="h-4 w-4" />}
        leaderboardsEnabled={leaderboardsEnabled}
        ticketIcon={<TicketIcon aria-hidden className="h-4 w-4" />}
      />
      <div className="w-full flex justify-center px-4 pb-8">
        <div className="grid w-full max-w-6xl grid-cols-2 gap-x-4 gap-y-6">
          {isEmpty(terminals) && (
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
          )}
          {routeGroups.map((routeGroup) => (
            <section className="col-span-2 min-w-0" key={routeGroup.id}>
              <h2 className="px-4 pb-2 text-center text-sm font-extrabold uppercase tracking-[0.18em] text-[#fce580] drop-shadow-sm">
                <span className="inline-flex items-center gap-2">
                  {hasFavoriteRoute(routeGroup, favoriteRouteIds) && (
                    <span className="inline-flex items-center">
                      <StarFilledIcon aria-hidden="true" className="h-3 w-3" />
                      <span className="sr-only">Contains a favorite route</span>
                    </span>
                  )}
                  {routeGroup.label}
                </span>
              </h2>
              <ul
                className={getTerminalGridClasses(routeGroup.terminalColumns)}
              >
                {routeGroup.terminals.map((terminal) => (
                  <Terminal
                    closestTerminal={closestTerminal}
                    terminal={terminal}
                    key={`${routeGroup.id}:${terminal.id}`}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
};
