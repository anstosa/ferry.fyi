import { DateTime } from "luxon";
import React, { type ReactElement } from "react";
import type { Schedule, Slot } from "shared/contracts/schedules";

import { getVesselVehicleCapacity } from "~/views/Schedule/capacityFullness";
import { formatForecast } from "~/views/Schedule/forecastRiskPresentation";

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

// share complete anonymous schedules across public pages
export const PublicScheduleDetails = ({
  schedule,
  title = "Sailings",
}: {
  schedule: Schedule;
  title?: string;
}): ReactElement => (
  <section className="my-4 space-y-3">
    <h2>
      {title}: <time dateTime={schedule.date}>{schedule.date}</time>
    </h2>
    {schedule.validRange ? (
      <p>
        Published range: <SailingTime value={schedule.validRange.from} /> to{" "}
        <SailingTime value={schedule.validRange.to} />.
      </p>
    ) : null}
    {schedule.slots.length ? (
      <ul className="space-y-3">
        {schedule.slots.map((slot) => (
          <SailingDetails slot={slot} key={slot.wuid} />
        ))}
      </ul>
    ) : (
      <p>No sailings are published for this service date.</p>
    )}
    <p className="text-sm">
      Capacity, weather and tide forecasts are estimates, not a boarding
      guarantee. Verify current conditions with Washington State Ferries.
    </p>
  </section>
);
