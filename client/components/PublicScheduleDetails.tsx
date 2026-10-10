import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import type { Schedule, Slot } from "shared/contracts/schedules";
import { getRecommendationServiceDate } from "shared/lib/sailingRecommendationRevision";

import { CompactSailingSummary } from "~/components/CompactSailingSummary";
import { isDuringDaylight } from "~/lib/daylight";
import { getVesselVehicleCapacity } from "~/views/Schedule/capacityFullness";
import { formatForecast } from "~/views/Schedule/forecastRiskPresentation";
import { getCurrentSlot } from "~/views/Schedule/nowDivider";
import { NowDivider } from "~/views/Schedule/NowDividerView";

// format a public sailing instant
const SailingTime = ({ value }: { value: number }): ReactElement => {
  const time = DateTime.fromSeconds(value, { zone: "America/Los_Angeles" });
  return (
    <time dateTime={time.toISO() ?? undefined}>
      {time.toFormat("h:mm a ZZZZ")}
    </time>
  );
};

// expose meaningful optional sailing facts
const SailingDetails = ({ slot }: { slot: Slot }): ReactElement => {
  const { crossing, estimate } = slot;
  const capacity =
    crossing?.totalCapacity ?? getVesselVehicleCapacity(slot.vessel);
  return (
    <li
      className="rounded-xl border border-black/10 p-4 dark:border-white/10"
      data-public-sailing={slot.wuid}
    >
      <p className="font-bold">
        <SailingTime value={slot.time} />
        {crossing?.isCancelled ? " — cancelled" : ""}
        {slot.cancellationReason
          ? ` — ${slot.cancellationReason} cancellation`
          : ""}
        {slot.vessel.name ? ` — ${slot.vessel.name}` : ""}
      </p>
      {typeof slot.arrivalTime === "number" ? (
        <p>
          Arrival: <SailingTime value={slot.arrivalTime} />
        </p>
      ) : null}
      <p>
        Passengers: {slot.allowsPassengers ? "allowed" : "not allowed"}.
        Vehicles: {slot.allowsVehicles ? "allowed" : "not allowed"}.
      </p>
      {crossing ? (
        <div>
          <p>
            {crossing.driveUpCapacity + crossing.reservableCapacity} vehicle
            spaces reported · drive-up: {crossing.driveUpCapacity} ·
            reservation: {crossing.reservableCapacity} · total capacity:{" "}
            {crossing.totalCapacity}.
          </p>
          <p>
            Drive-up: {crossing.hasDriveUp ? "available" : "not available"}.
            Reservations:{" "}
            {crossing.hasReservations ? "available" : "not available"}.
          </p>
          {typeof crossing.capacityReportUpdatedAt === "number" ? (
            <p>
              Capacity reported{" "}
              <SailingTime value={crossing.capacityReportUpdatedAt} />
            </p>
          ) : null}
          {typeof crossing.departureDelta === "number" ? (
            <p>
              Reported departure timing:{" "}
              {crossing.departureDelta === 0
                ? "on time"
                : `${Math.round(Math.abs(crossing.departureDelta) / 60)} minutes ${crossing.departureDelta < 0 ? "ahead" : "late"}`}
              .
            </p>
          ) : null}
        </div>
      ) : null}
      {estimate ? (
        <div>
          <p>{formatForecast(estimate, capacity)}</p>
          <p>
            Estimated drive-up spaces: {estimate.driveUpCapacity}
            {typeof estimate.reservableCapacity === "number"
              ? ` · reservation spaces: ${estimate.reservableCapacity}`
              : ""}
            .
          </p>
          {typeof estimate.fullProbability === "number" ? (
            <p>
              Chance of filling completely:{" "}
              {Math.round(estimate.fullProbability * 100)}%.
            </p>
          ) : null}
          {estimate.confidence ? (
            <p>Confidence: {estimate.confidence}.</p>
          ) : null}
          {estimate.source ? <p>Forecast source: {estimate.source}.</p> : null}
          {typeof estimate.sampleSize === "number" ? (
            <p>Historical sample: {estimate.sampleSize} observations.</p>
          ) : null}
          {estimate.routeClass ? (
            <p>Forecast route class: {estimate.routeClass}.</p>
          ) : null}
          <ul>
            {estimate.factors?.map((factor, index) => (
              <li key={`${factor.label}:${index}`}>
                {factor.label}: {factor.detail} ({factor.impact} demand).
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {slot.weather ? (
        <div aria-label="Sailing weather">
          <p>Weather forecast</p>
          {typeof slot.weather.temperatureC === "number" ? (
            <p>Temperature: {slot.weather.temperatureC}°C.</p>
          ) : null}
          {typeof slot.weather.highTemperatureC === "number" ? (
            <p>High temperature: {slot.weather.highTemperatureC}°C.</p>
          ) : null}
          {typeof slot.weather.windSpeedKmh === "number" ? (
            <p>Wind: {slot.weather.windSpeedKmh} km/h.</p>
          ) : null}
          {typeof slot.weather.windGustKmh === "number" ? (
            <p>Wind gusts: {slot.weather.windGustKmh} km/h.</p>
          ) : null}
          {typeof slot.weather.precipitationMm === "number" ? (
            <p>Precipitation: {slot.weather.precipitationMm} mm.</p>
          ) : null}
          {typeof slot.weather.cloudCoverPercent === "number" ? (
            <p>Cloud cover: {slot.weather.cloudCoverPercent}%.</p>
          ) : null}
        </div>
      ) : null}
      {slot.tide ? (
        <div aria-label="Sailing tide">
          <p>Tide station: {slot.tide.stationId}.</p>
          {typeof slot.tide.waterLevelM === "number" ? (
            <p>Departure water level: {slot.tide.waterLevelM} m MLLW.</p>
          ) : null}
          {slot.tide.arrivalStationId ? (
            <p>Arrival tide station: {slot.tide.arrivalStationId}.</p>
          ) : null}
          {typeof slot.tide.arrivalWaterLevelM === "number" ? (
            <p>Arrival water level: {slot.tide.arrivalWaterLevelM} m MLLW.</p>
          ) : null}
          {typeof slot.tide.lowestWaterLevelM === "number" ? (
            <p>
              Lowest crossing water level: {slot.tide.lowestWaterLevelM} m MLLW.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
};

interface SailingLocation {
  latitude: number;
  longitude: number;
}

// retain one sailing's complete facts behind its compact summary
const PastSailing = ({
  location,
  slot,
}: {
  location?: SailingLocation;
  slot: Slot;
}): ReactElement => {
  const isDaylight = location
    ? isDuringDaylight(
        DateTime.fromSeconds(slot.time, { zone: "America/Los_Angeles" }),
        { address: {}, ...location }
      )
    : true;
  return (
    <li>
      <details className="group border-b border-black/10 dark:border-white/10">
        <summary className="relative isolate flex h-7 cursor-pointer list-none items-center gap-2 overflow-hidden px-3 text-xs [&::-webkit-details-marker]:hidden">
          <CompactSailingSummary isDaylight={isDaylight} slot={slot} />
        </summary>
        <ul>
          <SailingDetails slot={slot} />
        </ul>
      </details>
    </li>
  );
};

// share complete anonymous schedules across public pages
export const PublicScheduleDetails = ({
  id,
  location,
  schedule,
  showDisclaimer = true,
  time,
  title = "Sailings",
}: {
  id?: string;
  location?: SailingLocation;
  schedule: Schedule;
  showDisclaimer?: boolean;
  time?: DateTime;
  title?: string | null;
}): ReactElement => {
  const currentSlot = time ? getCurrentSlot(schedule.slots, time) : null;
  // group only completed sailings on the current ferry service date
  let earlierCount = 0;
  if (
    time &&
    schedule.date === getRecommendationServiceDate(time.toSeconds())
  ) {
    earlierCount = currentSlot
      ? schedule.slots.indexOf(currentSlot)
      : schedule.slots.length;
  }
  const completedSlots = schedule.slots.slice(0, earlierCount);
  const recentSlots = completedSlots.slice(-4);
  const olderSlots = completedSlots.slice(0, -4);
  return (
    <section id={id} className="my-4 space-y-3">
      {/* the current page already names its date above the sailing list */}
      {title && (
        <h2>
          {title}: <time dateTime={schedule.date}>{schedule.date}</time>
        </h2>
      )}
      {schedule.validRange ? (
        <p>
          Published range: <SailingTime value={schedule.validRange.from} /> to{" "}
          <SailingTime value={schedule.validRange.to} />.
        </p>
      ) : null}
      {/* native history is compact and usable without javascript */}
      {earlierCount > 0 && (
        <div
          data-past-sailings
          className="border-y border-black/10 dark:border-white/10"
        >
          {olderSlots.length > 0 && (
            <details data-older-sailings>
              <summary className="h-7 cursor-pointer px-3 py-1 text-xs font-semibold">
                Earlier sailings ({olderSlots.length})
              </summary>
              <ul>
                {olderSlots.map((slot) => (
                  <PastSailing
                    key={slot.wuid}
                    location={location}
                    slot={slot}
                  />
                ))}
              </ul>
            </details>
          )}
          <ul data-recent-sailings>
            {recentSlots.map((slot) => (
              <PastSailing key={slot.wuid} location={location} slot={slot} />
            ))}
          </ul>
        </div>
      )}
      {schedule.slots.length ? (
        <ul className="space-y-3">
          {earlierCount > 0 && time && <NowDivider time={time} />}
          {schedule.slots.slice(earlierCount).map((slot) => (
            <SailingDetails slot={slot} key={slot.wuid} />
          ))}
        </ul>
      ) : (
        <p>No sailings are published for this service date.</p>
      )}
      {showDisclaimer && (
        <p className="text-sm">
          Capacity, weather and tide forecasts are estimates, not a boarding
          guarantee. Verify current conditions with Washington State Ferries.
        </p>
      )}
    </section>
  );
};
