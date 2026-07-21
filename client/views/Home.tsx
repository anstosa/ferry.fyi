import clsx from "clsx";
import React, { ReactElement } from "react";
import { Link } from "react-router-dom";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { isEmpty } from "shared/lib/arrays";
import { getSeoMetadata } from "shared/lib/seo";

import { LoadingWaves } from "~/components/LoadingWaves";
import { SeoHelmet } from "~/components/SeoHelmet";
import { useFavoriteRoutes } from "~/lib/favoriteRoutes";
import {
  getRouteGroups,
  hasFavoriteRoute,
  sortRouteGroups,
} from "~/lib/routeGroups";
import { getSlug, useTerminals } from "~/lib/terminals";
import logo from "~/static/images/icon_monochrome.png";
import TicketIcon from "~/static/images/icons/solid/barcode-alt.svg";
import GpsTargetIcon from "~/static/images/icons/solid/location.svg";
import StarFilledIcon from "~/static/images/icons/solid/star.svg";

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
  if (location.host === "howmanyboats.today") {
    return <Today />;
  }
  const { terminals, closestTerminal } = useTerminals();
  const [favoriteRouteIds] = useFavoriteRoutes();
  const routeGroups = sortRouteGroups(
    getRouteGroups(terminals),
    closestTerminal,
    favoriteRouteIds
  );
  return (
    <div className="relative min-h-screen min-h-[100dvh] overflow-y-scroll scrolling-touch bg-ferry-gradient text-white">
      <SeoHelmet seo={getSeoMetadata("/")} />
      <Link
        className="absolute top-0 left-0 mt-safe-top flex items-center px-4 py-2 text-lg font-bold hover:bg-lighten-high"
        to="/tickets"
      >
        <TicketIcon className="mr-3" />
        Tickets
      </Link>
      <div className="flex flex-col items-center justify-center w-full h-60">
        <img src={logo} className="w-28" />
        <h1 className="text-4xl font-bold">Ferry FYI</h1>
      </div>
      <div className="w-full flex justify-center px-4 pb-8">
        <div className="grid w-full max-w-6xl grid-cols-2 gap-x-4 gap-y-6">
          {isEmpty(terminals) && (
            <div
              className={clsx(
                LI_CLASSES,
                "col-span-2 flex flex-col items-center justify-center gap-2 opacity-80"
              )}
            >
              <LoadingWaves
                className="h-10 w-28 text-yellow-lightest"
                label="Loading terminals"
                svgClassName="h-8 w-28"
              />
              <span>Loading terminals…</span>
            </div>
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
    </div>
  );
};
