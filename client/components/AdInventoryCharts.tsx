import { DateTime } from "luxon";
import React, { ReactElement } from "react";
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

interface BarChartRow {
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

// render one accessible horizontal chart
const HorizontalBarChart = ({
  rows,
  title,
}: {
  rows: BarChartRow[];
  title: string;
}): ReactElement => {
  const maximum = Math.max(1, ...rows.map(({ value }) => value));
  return (
    <figure className="rounded-xl border border-gray-light p-3 dark:border-gray-dark">
      <figcaption className="font-semibold">{title}</figcaption>
      <ul className="mt-3 space-y-2">
        {/* render exact accessible buckets */}
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{row.label}</span>
              <strong>{formatCount(row.value)}</strong>
            </div>
            <div
              aria-hidden="true"
              className="mt-1 h-2 overflow-hidden rounded-full bg-gray-light dark:bg-white/10"
            >
              <div
                className="h-full rounded-full bg-sponsor-dark dark:bg-sponsor-light"
                style={{ width: `${(row.value / maximum) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
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
      label: weekdayLabels[row.weekday - 1] ?? String(row.weekday),
      value: Number(row.opportunityCount),
    })) ?? [];
  const hourRows =
    selected?.hourOfDay.map((row) => ({
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
            {report.placements.map((placement) => {
              const count = Number(placement.opportunityCount);
              const selectedRow =
                selectedPlacementKey === placement.placementKey;
              return (
                <li key={placement.placementKey}>
                  <button
                    aria-pressed={selectedRow}
                    className={`w-full rounded-xl border p-3 text-left transition hover:border-sponsor-dark hover:bg-sponsor-lightest dark:hover:border-sponsor-light dark:hover:bg-sponsor-darkest ${
                      selectedRow
                        ? "border-sponsor-dark bg-sponsor-lightest dark:border-sponsor-light dark:bg-sponsor-darkest"
                        : "border-gray-light dark:border-gray-dark"
                    }`}
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

      {selected ? (
        <section
          aria-labelledby="admin-ad-placement-breakdown-title"
          className="rounded-xl border border-sponsor-light p-4 dark:border-sponsor-dark"
        >
          <h4 className="font-semibold" id="admin-ad-placement-breakdown-title">
            {formatAdInventoryPlacement(selected.placementKey, terminals)}
          </h4>
          <p className="mt-1 text-sm">
            {formatCount(selected.opportunityCount)} opportunities across the
            selected date range.
          </p>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <HorizontalBarChart rows={weekdayRows} title="Day of week" />
            <HorizontalBarChart rows={hourRows} title="Time of day" />
          </div>
          <p className="mt-3 text-xs text-gray-dark dark:text-gray-light">
            Times use America/Los_Angeles. Hourly measurement in this range
            {selected.hourlyDataStartDate
              ? ` begins ${selected.hourlyDataStartDate}`
              : " has not started yet"}
            ; earlier daily totals cannot be reconstructed by hour.
          </p>
        </section>
      ) : null}
    </div>
  );
};
