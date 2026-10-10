import React, { type ReactElement } from "react";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";
import {
  getCanonicalRouteBasePath,
  getStaticPublicSsrTerminalSlug,
} from "shared/lib/ssrRouteMatch";

import { RouteQuickLinks } from "~/components/RouteQuickLinks";
import { useAppRenderContext } from "~/lib/renderContext";
import { ROUTE_VIEW_ORDER, type RouteView } from "~/lib/routeViews";
import AlertsIcon from "~/static/images/icons/solid/bell-exclamation.svg";
import CalculatorIcon from "~/static/images/icons/solid/calculator.svg";
import ScheduleIcon from "~/static/images/icons/solid/calendar-week.svg";
import CamerasIcon from "~/static/images/icons/solid/cctv.svg";
import FaresIcon from "~/static/images/icons/solid/dollar-sign.svg";
import TerminalIcon from "~/static/images/icons/solid/garage-car.svg";
import NavigationIcon from "~/static/images/icons/solid/location-arrow.svg";
import MapIcon from "~/static/images/icons/solid/map.svg";

export interface PlanningTerminal {
  id: string;
  mates?: readonly { id: string }[];
}

const PLANNING_LABELS = {
  alerts: "Alert planning links",
  fare: "Fare planning links",
  navigation: "Navigation planning links",
};

interface PlanningLinkDefinition {
  Icon: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  label: string;
}

const PLANNING_LINKS: Partial<Record<RouteView, PlanningLinkDefinition>> = {
  schedule: { Icon: ScheduleIcon, label: "Schedule & wait" },
  navigation: {
    Icon: NavigationIcon,
    label: "What boat will I make?",
  },
  cameras: { Icon: CamerasIcon, label: "Ferry line cameras" },
  terminal: { Icon: TerminalIcon, label: "Terminal info" },
  map: { Icon: MapIcon, label: "Route Map" },
  fare: { Icon: FaresIcon, label: "How much does it cost?" },
  alerts: { Icon: AlertsIcon, label: "WSF Alerts" },
};

// follow bottom-bar order without copying private trip parameters
export const RoutePlanningLinks = ({
  currentView,
  includeCustomFare = currentView === "fare",
  mate,
  selectedDate,
  terminal,
}: {
  currentView: "navigation" | "fare" | "alerts";
  includeCustomFare?: boolean;
  mate?: { id: string } | null;
  selectedDate?: string;
  terminal?: PlanningTerminal;
}): ReactElement | null => {
  const { clock } = useAppRenderContext();
  const terminalSlug = terminal
    ? getStaticPublicSsrTerminalSlug(terminal.id)
    : undefined;
  const destination = mate ?? terminal?.mates?.[0];
  const routePath = terminal
    ? getCanonicalRouteBasePath(terminal.id, destination?.id)
    : null;
  const dateQuery =
    selectedDate &&
    selectedDate !== getRecommendationServiceDate(clock() / 1000)
      ? `?date=${encodeURIComponent(selectedDate)}`
      : "";
  // dated schedules and fares retain their service date; live-only tools stay current
  const planningPath = (view: string): string => {
    const path =
      view === "terminal"
        ? `/${terminalSlug}/terminal`
        : `${routePath}${view === "schedule" ? "" : `/${view}`}`;
    return `${path}${["schedule", "fare"].includes(view) ? dateQuery : ""}`;
  };
  const tools = ROUTE_VIEW_ORDER.flatMap((view) => {
    const definition = PLANNING_LINKS[view];
    // omit subscribe and any non-planning destinations
    return definition ? [{ ...definition, view }] : [];
  });
  // omit the current page while preserving each destination's bottom-bar position
  const links = tools.flatMap(({ Icon, label, view }) => {
    const routeLinks =
      routePath && view !== currentView
        ? [{ Icon, label, path: planningPath(view) }]
        : [];
    // keep the solid custom calculator action in the fares position
    return view === "fare" && includeCustomFare
      ? [
          ...routeLinks,
          {
            Icon: CalculatorIcon,
            inPage: true,
            label: "Calculate a custom fare",
            path: "#custom-fare-calculator",
            solid: true,
          },
        ]
      : routeLinks;
  });
  // unknown identities must not produce fabricated route links or an empty landmark
  if (!links.length) {
    return null;
  }
  return (
    <RouteQuickLinks ariaLabel={PLANNING_LABELS[currentView]} links={links} />
  );
};
