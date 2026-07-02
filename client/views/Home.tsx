import clsx from "clsx";
import React, { ReactElement } from "react";
import { Link } from "react-router-dom";
import { Terminal as TerminalClass } from "shared/contracts/terminals";
import { isEmpty } from "shared/lib/arrays";

import { LoadingWaves } from "~/components/LoadingWaves";
import { getSlug, useTerminals } from "~/lib/terminals";
import logo from "~/static/images/icon_monochrome.png";
import TicketIcon from "~/static/images/icons/solid/barcode-alt.svg";
import GpsTargetIcon from "~/static/images/icons/solid/location.svg";

import { Today } from "./Today";

interface RouteGroupConfig {
  annualTraffic: number;
  id: string;
  label: string;
  routeIds: string[];
  terminalColumns?: 2 | 3;
  terminalIds?: string[];
}

interface RouteGroup extends RouteGroupConfig {
  terminals: TerminalClass[];
}

interface TerminalProps {
  closestTerminal: TerminalClass | null;
  terminal: TerminalClass;
}

// 2025 total riders order
const ROUTE_GROUPS: RouteGroupConfig[] = [
  {
    annualTraffic: 5_217_546,
    id: "bainbridge-island",
    label: "Bainbridge Island",
    routeIds: ["5"],
  },
  {
    annualTraffic: 4_438_712,
    id: "whidbey-island",
    label: "Whidbey Island",
    routeIds: ["7", "8"],
    terminalColumns: 2,
    terminalIds: ["5", "14", "11", "17"],
  },
  {
    annualTraffic: 3_863_436,
    id: "kingston",
    label: "Kingston",
    routeIds: ["6"],
  },
  {
    annualTraffic: 1_954_626,
    id: "san-juan-islands",
    label: "San Juan Islands",
    routeIds: ["9"],
    terminalColumns: 2,
    terminalIds: ["10", "15", "13", "18", "1"],
  },
  {
    annualTraffic: 1_729_690,
    id: "vashon-island",
    label: "Vashon Island",
    routeIds: ["14", "15"],
    terminalColumns: 3,
    terminalIds: ["9", "22", "20"],
  },
  {
    annualTraffic: 1_306_263,
    id: "bremerton",
    label: "Bremerton",
    routeIds: ["3"],
  },
  {
    annualTraffic: 960_584,
    id: "point-defiance",
    label: "Point Defiance",
    routeIds: ["1"],
  },
  {
    annualTraffic: 637_688,
    id: "west-seattle",
    label: "West Seattle",
    routeIds: ["13"],
  },
];

const LI_CLASSES = clsx(
  "whitespace-nowrap",
  "block cursor-pointer",
  "px-1 py-2",
  "hover:bg-lighten-high",
  "flex items-center justify-center",
  "text-base sm:text-lg"
);

// build terminal lookup
const getTerminalsById = (
  terminals: TerminalClass[]
): Record<string, TerminalClass> =>
  Object.fromEntries(terminals.map((terminal) => [terminal.id, terminal]));

// collect terminal ids
const getGroupTerminalIds = (
  terminals: TerminalClass[],
  config: RouteGroupConfig
): string[] => {
  // explicit order
  if (config.terminalIds) {
    return config.terminalIds;
  }
  const terminalIds: string[] = [];
  // terminal rows
  terminals.forEach((terminal) => {
    // route ids
    config.routeIds.forEach((routeId) => {
      const route = terminal.routes?.[routeId];
      // missing route guard
      if (!route) {
        return;
      }
      route.terminalIds.forEach((terminalId) => {
        // duplicate terminal guard
        if (terminalIds.includes(terminalId)) {
          return;
        }
        terminalIds.push(terminalId);
      });
    });
  });
  return terminalIds;
};

// terminal column classes
const getTerminalGridClasses = (columns = 2): string =>
  clsx("grid max-[299px]:grid-cols-1 border-t border-white border-opacity-20", {
    "grid-cols-2": columns === 2,
    "grid-cols-3": columns === 3,
  });

// collect route groups
const getRouteGroups = (terminals: TerminalClass[]): RouteGroup[] => {
  const terminalsById = getTerminalsById(terminals);
  return ROUTE_GROUPS.map((config) => ({
    ...config,
    terminals: getGroupTerminalIds(terminals, config)
      .map((terminalId) => terminalsById[terminalId])
      .filter((terminal): terminal is TerminalClass => Boolean(terminal)),
  })).filter((group) => group.terminals.length > 0);
};

// route has closest terminal
const hasClosestTerminal = (
  group: RouteGroup,
  closestTerminal: TerminalClass | null
): boolean =>
  Boolean(
    closestTerminal &&
    group.terminals.some((terminal) => terminal.id === closestTerminal.id)
  );

// sort route groups
const sortRouteGroups = (
  groups: RouteGroup[],
  closestTerminal: TerminalClass | null
): RouteGroup[] => {
  const sortedGroups = [...groups].sort(
    (left, right) => right.annualTraffic - left.annualTraffic
  );
  // closest route guard
  if (!closestTerminal) {
    return sortedGroups;
  }
  const closestIndex = sortedGroups.findIndex((group) =>
    hasClosestTerminal(group, closestTerminal)
  );
  // missing closest guard
  if (closestIndex < 0) {
    return sortedGroups;
  }
  const [closestGroup] = sortedGroups.splice(closestIndex, 1);
  return [closestGroup, ...sortedGroups];
};

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
  const routeGroups = sortRouteGroups(
    getRouteGroups(terminals),
    closestTerminal
  );
  return (
    <div className="relative overflow-y-scroll scrolling-touch bg-ferry-gradient text-white">
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
        <div className="grid w-full max-w-3xl grid-cols-2 gap-x-4 gap-y-6">
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
                {routeGroup.label}
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
