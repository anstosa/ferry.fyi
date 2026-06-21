import { DateTime } from "luxon";
import type { TerminalLocation } from "shared/contracts/terminals";

const ZENITH = 90.833;

interface DaylightWindow {
  sunrise: DateTime;
  sunset: DateTime;
}

// align local date
const alignToLocalDate = (sunTime: DateTime, date: DateTime): DateTime => {
  let aligned = sunTime;
  // previous day guard
  if (aligned < date.startOf("day")) {
    aligned = aligned.plus({ days: 1 });
  }
  // next day guard
  if (aligned > date.endOf("day")) {
    aligned = aligned.minus({ days: 1 });
  }
  return aligned;
};

// normalize degrees
const normalizeDegrees = (degrees: number): number =>
  ((degrees % 360) + 360) % 360;

// normalize hours
const normalizeHours = (hours: number): number => ((hours % 24) + 24) % 24;

// convert degrees
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

// convert radians
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

// approximate sun time
const getSunTimeHours = (
  date: DateTime,
  location: TerminalLocation,
  isSunrise: boolean
): number => {
  const dayOfYear = date.ordinal;
  const longitudeHour = location.longitude / 15;
  const targetHour = isSunrise ? 6 : 18;
  const approximateTime = dayOfYear + (targetHour - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(toRadians(meanAnomaly)) +
      0.02 * Math.sin(toRadians(2 * meanAnomaly)) +
      282.634
  );
  let rightAscension = normalizeDegrees(
    toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude))))
  );
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension =
    (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;
  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosLocalHour =
    (Math.cos(toRadians(ZENITH)) -
      sinDeclination * Math.sin(toRadians(location.latitude))) /
    (cosDeclination * Math.cos(toRadians(location.latitude)));

  // polar daylight guard
  if (cosLocalHour < -1) {
    return isSunrise ? 0 : 24;
  }

  // polar night guard
  if (cosLocalHour > 1) {
    return isSunrise ? 12 : 12;
  }

  const localHourAngle = isSunrise
    ? 360 - toDegrees(Math.acos(cosLocalHour))
    : toDegrees(Math.acos(cosLocalHour));
  const localMeanTime =
    localHourAngle / 15 + rightAscension - 0.06571 * approximateTime - 6.622;
  return normalizeHours(localMeanTime - longitudeHour);
};

// approximate daylight window
export const getDaylightWindow = (
  date: DateTime,
  location: TerminalLocation
): DaylightWindow => {
  const sunriseHours = getSunTimeHours(date, location, true);
  const sunsetHours = getSunTimeHours(date, location, false);
  const utcDay = DateTime.utc(date.year, date.month, date.day);
  const sunrise = utcDay.plus({ hours: sunriseHours }).setZone(date.zone);
  const sunset = utcDay.plus({ hours: sunsetHours }).setZone(date.zone);
  return {
    sunrise: alignToLocalDate(sunrise, date),
    sunset: alignToLocalDate(sunset, date),
  };
};

// daylight check
export const isDuringDaylight = (
  time: DateTime,
  location: TerminalLocation
): boolean => {
  const { sunrise, sunset } = getDaylightWindow(time, location);
  return time >= sunrise && time <= sunset;
};
