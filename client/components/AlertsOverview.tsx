import clsx from "clsx";
import React, { type ReactElement } from "react";

import { RoutePageIntro } from "~/components/RoutePageIntro";
import { RoutePlanningLinks } from "~/components/RoutePlanningLinks";

export interface AlertsTerminal {
  id: string;
  mates?: readonly { id: string }[];
  name: string;
}

// lead with the route and the practical reason to check alerts
export const AlertsOverview = ({
  inset = true,
  mate,
  selectedDate,
  terminal,
}: {
  inset?: boolean;
  mate?: Pick<AlertsTerminal, "id" | "name"> | null;
  selectedDate?: string;
  terminal: AlertsTerminal;
}): ReactElement => (
  <section
    className={clsx(
      "border-b border-black/10 dark:border-white/10",
      inset && "p-4"
    )}
  >
    <RoutePageIntro
      title={
        mate
          ? `${terminal.name} to ${mate.name} WSF alerts`
          : `${terminal.name} ferry terminal alerts`
      }
      description="Check current Washington State Ferries service changes, delays and cancellations before you travel."
    />
    <RoutePlanningLinks
      currentView="alerts"
      mate={mate}
      selectedDate={selectedDate}
      terminal={terminal}
    />
  </section>
);
