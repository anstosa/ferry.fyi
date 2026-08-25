import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import {
  type AdInventoryReport,
  parseAdPlacementKey,
} from "shared/contracts/ads";
import type { Terminal } from "shared/contracts/terminals";

const slotLabels = {
  cameras: "Cameras",
  fare: "Fares",
  home: "Home",
  schedule: "Schedule",
  terminal: "Terminal details",
} as const;

const weekdayLabels = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

interface BarChartColumn {
  axisLabel: string;
  label: string;
  value: number;
}

// format aggregate counts
const formatCount = (value: string | number): string =>
  new Intl.NumberFormat("en-US").format(Number(value));

// label one pacific hour
const formatHour = (hour: number): string =>
  DateTime.fromObject({ hour }).toFormat("h a");

// label one placement
const formatAdInventoryPlacement = (
  placementKey: string,
  terminals: Terminal[]
): string => {
  const parsed = parseAdPlacementKey(placementKey);
  // preserve unknown historical keys
  if (!parsed) {
    return placementKey;
  }
  // label the global slot
  if (parsed.slot === "home") {
    return slotLabels.home;
  }
  const departure = terminals.find(
    (terminal) => terminal.id === parsed.departureTerminalId
  );
  const arrival = terminals.find(
    (terminal) => terminal.id === parsed.arrivalTerminalId
  );
  return `${slotLabels[parsed.slot]} · ${departure?.name ?? parsed.departureTerminalId} → ${arrival?.name ?? parsed.arrivalTerminalId}`;
};

// render one accessible vertical chart
const VerticalBarChart = ({
  columns,
  title,
}: {
  columns: BarChartColumn[];
  title: string;
}): ReactElement => {
  const maximum = Math.max(1, ...columns.map(({ value }) => value));
  // keep dense hourly labels readable
  const horizontallyScrollable = columns.length > 12;
  const minimumWidth = horizontallyScrollable ? "min-w-[60rem]" : "min-w-full";
  return (
    <figure className="min-w-0">
      <figcaption className="font-semibold">{title}</figcaption>
      <div
        aria-label={
          horizontallyScrollable
            ? `${title} chart, scroll horizontally to view all columns`
            : undefined
        }
        className="mt-3 overflow-x-auto pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sponsor-dark dark:focus-visible:outline-sponsor-light"
        role={horizontallyScrollable ? "region" : undefined}
        tabIndex={horizontallyScrollable ? 0 : undefined}
      >
        <ul
          aria-label={`${title} x-axis`}
          className={`flex h-44 items-end gap-2 ${minimumWidth}`}
        >
          {/* render exact accessible columns */}
          {columns.map((column) => (
            <li
              aria-label={`${column.label}: ${formatCount(column.value)}`}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              key={column.label}
            >
              <strong aria-hidden="true" className="text-xs tabular-nums">
                {formatCount(column.value)}
              </strong>
              <span
                aria-hidden="true"
                className="mt-1 flex h-28 w-full items-end justify-center border-b border-gray-medium"
              >
                <span
                  className="block w-full max-w-8 rounded-t bg-sponsor-dark dark:bg-sponsor-light"
                  style={{ height: `${(column.value / maximum) * 100}%` }}
                />
              </span>
              <span
                aria-hidden="true"
                className="mt-1 whitespace-nowrap text-xs"
              >
                {column.axisLabel}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
};

// render inventory overview and drill-down
export const AdInventoryCharts = ({
  loading,
  onSelectPlacement,
  report,
  selectedPlacementKey,
  terminals,
}: {
  loading: boolean;
  onSelectPlacement: (placementKey: string) => void;
  report: AdInventoryReport;
  selectedPlacementKey: string | null;
  terminals: Terminal[];
}): ReactElement => {
  const start = DateTime.fromISO(report.startDate);
  const end = DateTime.fromISO(report.endDate);
  const dayCount = Math.max(1, Math.round(end.diff(start, "days").days) + 1);
  const total = Number(report.totalOpportunityCount);
  const selected = report.selectedPlacement;
  const weekdayRows =
    selected?.weekday.map((row) => ({
      axisLabel: (weekdayLabels[row.weekday - 1] ?? String(row.weekday)).slice(
        0,
        3
      ),
      label: weekdayLabels[row.weekday - 1] ?? String(row.weekday),
      value: Number(row.opportunityCount),
    })) ?? [];
  const hourRows =
    selected?.hourOfDay.map((row) => ({
      axisLabel: formatHour(row.hour),
      label: formatHour(row.hour),
      value: Number(row.opportunityCount),
    })) ?? [];

  return (
    <div className="mt-4 space-y-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-sponsor-lightest p-3 dark:bg-sponsor-darkest">
          <dt className="text-xs font-semibold uppercase tracking-wide">
            Opportunities
          </dt>
          <dd className="mt-1 text-2xl font-bold">
            {formatCount(report.totalOpportunityCount)}
          </dd>
        </div>
        <div className="rounded-xl bg-sponsor-lightest p-3 dark:bg-sponsor-darkest">
          <dt className="text-xs font-semibold uppercase tracking-wide">
            Average per day
          </dt>
          <dd className="mt-1 text-2xl font-bold">
            {formatCount(Math.round(total / dayCount))}
          </dd>
        </div>
        <div className="rounded-xl bg-sponsor-lightest p-3 dark:bg-sponsor-darkest">
          <dt className="text-xs font-semibold uppercase tracking-wide">
            Tracked placements
          </dt>
          <dd className="mt-1 text-2xl font-bold">
            {formatCount(report.placements.length)}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="admin-ad-placement-chart-title">
        <h4 className="font-semibold" id="admin-ad-placement-chart-title">
          Opportunities by placement
        </h4>
        <p className="mt-1 text-sm text-gray-dark dark:text-gray-light">
          Select a placement for Pacific-time weekday and hour-of-day detail.
        </p>
        {report.placements.length ? (
          <ol className="mt-3 space-y-2">
            {/* render every tracked placement */}
            {report.placements.map((placement, index) => {
              const count = Number(placement.opportunityCount);
              const selectedRow =
                selectedPlacementKey === placement.placementKey;
              const detailId = `admin-ad-placement-breakdown-${index}`;
              const expandedPlacement =
                selectedRow && selected?.placementKey === placement.placementKey
                  ? selected
                  : null;
              return (
                <li
                  className={`overflow-hidden rounded-xl border transition ${
                    selectedRow
                      ? "border-sponsor-dark bg-sponsor-lightest dark:border-sponsor-light dark:bg-sponsor-darkest"
                      : "border-gray-light dark:border-gray-dark"
                  }`}
                  key={placement.placementKey}
                >
                  <button
                    aria-controls={expandedPlacement ? detailId : undefined}
                    aria-expanded={Boolean(expandedPlacement)}
                    aria-pressed={selectedRow}
                    className="w-full p-3 text-left transition hover:bg-sponsor-lightest dark:hover:bg-sponsor-darkest"
                    disabled={loading}
                    onClick={() => onSelectPlacement(placement.placementKey)}
                    type="button"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <strong>
                        {formatAdInventoryPlacement(
                          placement.placementKey,
                          terminals
                        )}
                      </strong>
                      <span>{formatCount(count)}</span>
                    </span>
                    <span className="mt-1 flex justify-between gap-3 text-xs text-gray-dark dark:text-gray-light">
                      <span>
                        {formatCount(Math.round(count / dayCount))}/day
                      </span>
                      <span>
                        {total ? ((count / total) * 100).toFixed(1) : "0.0"}%
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-2 block h-2 overflow-hidden rounded-full bg-gray-light dark:bg-white/10"
                    >
                      <span
                        className="block h-full rounded-full bg-sponsor-dark dark:bg-sponsor-light"
                        style={{
                          width: `${total ? (count / total) * 100 : 0}%`,
                        }}
                      />
                    </span>
                  </button>
                  {expandedPlacement ? (
                    <section
                      aria-labelledby={`${detailId}-title`}
                      className="border-t border-sponsor-light px-3 pb-4 pt-3 dark:border-sponsor-dark"
                      id={detailId}
                    >
                      <h5 className="sr-only" id={`${detailId}-title`}>
                        {formatAdInventoryPlacement(
                          placement.placementKey,
                          terminals
                        )}{" "}
                        detail
                      </h5>
                      <p className="text-sm">
                        {formatCount(expandedPlacement.opportunityCount)}
                        {" opportunities across the selected date range."}
                      </p>
                      <div className="mt-4 space-y-6">
                        <VerticalBarChart
                          columns={weekdayRows}
                          title="Day of week"
                        />
                        <VerticalBarChart
                          columns={hourRows}
                          title="Time of day"
                        />
                      </div>
                      <p className="mt-3 text-xs text-gray-dark dark:text-gray-light">
                        Times use America/Los_Angeles. Hourly measurement in
                        this range
                        {expandedPlacement.hourlyDataStartDate
                          ? ` begins ${expandedPlacement.hourlyDataStartDate}`
                          : " has not started yet"}
                        ; earlier daily totals cannot be reconstructed by hour.
                      </p>
                    </section>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-3 text-sm">
            No inventory was measured in this range.
          </p>
        )}
      </section>
    </div>
  );
};
