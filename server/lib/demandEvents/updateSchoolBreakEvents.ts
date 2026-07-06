import logger from "heroku-logger";
import { DateTime, Interval } from "luxon";
import { Op } from "sequelize";

import {
  type DemandEventInput,
  persistDemandEvents,
} from "~/lib/demandEvents/persistDemandEvents";
import { DemandEvent } from "~/models/DemandEvent";

const DEFAULT_YEARS_AHEAD = 2;
const DEFAULT_YEARS_BACK = 1;
const SCHOOL_BREAK_PRESSURE = 0.08;
const SEATTLE_ZONE = "America/Los_Angeles";
const OSPI_BREAK_SOURCE = "ospi-school-breaks";
const GENERATED_BREAK_SOURCE = "generated-school-breaks";

interface SchoolBreakRange {
  end: DateTime;
  kind: "mid-winter" | "spring" | "winter";
  source: string;
  start: DateTime;
}

export interface SchoolBreakUpdateInput {
  fetchHtml?: typeof fetch;
  from?: DateTime;
  to?: DateTime;
}

// school year slug
const getSchoolYearSlug = (startYear: number): string =>
  `${startYear}-${String(startYear + 1).slice(-2)}`;

// OSPI break url
const getOspiBreakUrl = (startYear: number): string =>
  `https://ospi.k12.wa.us/about-ospi/about-school-districts/${getSchoolYearSlug(
    startYear
  )}-school-breaks`;

// school year starts
const getSchoolYearStarts = (from: DateTime, to: DateTime): number[] => {
  const starts = new Set<number>();
  let cursor = from.minus({ years: 1 }).startOf("year");
  // year scan
  while (cursor <= to) {
    starts.add(cursor.year);
    cursor = cursor.plus({ years: 1 });
  }
  return Array.from(starts).sort((left, right) => left - right);
};

// date normalization
const parseSchoolDate = (value: string, startYear: number): DateTime | null => {
  const [monthValue, dayValue, yearValue] = value.split("/");
  const month = Number(monthValue);
  const day = Number(dayValue);
  let year = Number(yearValue);
  // partial date guard
  if (!month || !day) {
    return null;
  }
  // implicit school-year guard
  if (!year) {
    year = month >= 8 ? startYear : startYear + 1;
  } else if (year < 100) {
    year += 2000;
  }
  const parsed = DateTime.fromObject(
    { day, month, year },
    { zone: SEATTLE_ZONE }
  );
  return parsed.isValid ? parsed.startOf("day") : null;
};

// classify break range
const getBreakKind = (
  start: DateTime,
  end: DateTime
): SchoolBreakRange["kind"] | null => {
  const durationDays = Math.floor(end.diff(start, "days").days) + 1;
  // winter break guard
  if (start.month === 12 || end.month === 1) {
    return "winter";
  }
  // mid-winter guard
  if (start.month === 2 && durationDays <= 7) {
    return "mid-winter";
  }
  // spring guard
  if ((start.month === 3 || start.month === 4) && durationDays <= 14) {
    return "spring";
  }
  return null;
};

// compact html text
const stripHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

// parse OSPI break ranges
export const parseOspiSchoolBreakRanges = (
  html: string,
  startYear: number
): SchoolBreakRange[] => {
  const text = stripHtml(html);
  const counts = new Map<string, { count: number; range: SchoolBreakRange }>();
  const rangePattern =
    /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*-\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/g;
  // range scan
  for (const match of text.matchAll(rangePattern)) {
    const start = parseSchoolDate(match[1], startYear);
    const end = parseSchoolDate(match[2], startYear);
    // invalid range guard
    if (!start || !end || end < start) {
      continue;
    }
    const kind = getBreakKind(start, end);
    // unsupported range guard
    if (!kind) {
      continue;
    }
    const key = `${kind}:${start.toISODate()}:${end.toISODate()}`;
    const existing = counts.get(key);
    counts.set(key, {
      count: (existing?.count ?? 0) + 1,
      range: { end, kind, source: OSPI_BREAK_SOURCE, start },
    });
  }
  const bestByKind = new Map<SchoolBreakRange["kind"], SchoolBreakRange>();
  const countByKind = new Map<SchoolBreakRange["kind"], number>();
  // common range scan
  counts.forEach(({ count, range }) => {
    const existingCount = countByKind.get(range.kind) ?? 0;
    // majority range guard
    if (count > existingCount) {
      bestByKind.set(range.kind, range);
      countByKind.set(range.kind, count);
    }
  });
  return Array.from(bestByKind.values()).sort(
    (left, right) => left.start.toSeconds() - right.start.toSeconds()
  );
};

// third monday
const getThirdMonday = (year: number, month: number): DateTime => {
  const firstDay = DateTime.fromObject(
    { day: 1, month, year },
    { zone: SEATTLE_ZONE }
  );
  const daysUntilMonday = (8 - firstDay.weekday) % 7;
  return firstDay.plus({ days: daysUntilMonday + 14 }).startOf("day");
};

// generated fallback ranges
const getGeneratedSchoolBreakRanges = (
  startYear: number
): SchoolBreakRange[] => {
  const winterStart = DateTime.fromObject(
    { day: 22, month: 12, year: startYear },
    { zone: SEATTLE_ZONE }
  );
  const presidentsDay = getThirdMonday(startYear + 1, 2);
  const springStart = DateTime.fromObject(
    { day: 6, month: 4, year: startYear + 1 },
    { zone: SEATTLE_ZONE }
  );
  return [
    {
      end: winterStart.plus({ days: 11 }),
      kind: "winter",
      source: GENERATED_BREAK_SOURCE,
      start: winterStart,
    },
    {
      end: presidentsDay.plus({ days: 4 }),
      kind: "mid-winter",
      source: GENERATED_BREAK_SOURCE,
      start: presidentsDay,
    },
    {
      end: springStart.plus({ days: 4 }),
      kind: "spring",
      source: GENERATED_BREAK_SOURCE,
      start: springStart,
    },
  ];
};

// fetch OSPI ranges
const fetchOspiSchoolBreakRanges = async (
  startYear: number,
  fetchHtml: typeof fetch
): Promise<SchoolBreakRange[]> => {
  const url = getOspiBreakUrl(startYear);
  const response = await fetchHtml(url, { headers: { Accept: "text/html" } });
  // missing page guard
  if (!response.ok) {
    logger.warn(`OSPI school breaks unavailable ${response.status}: ${url}`);
    return [];
  }
  const html = await response.text();
  return parseOspiSchoolBreakRanges(html, startYear);
};

// range containment
const overlapsRange = (
  range: SchoolBreakRange,
  from: DateTime,
  to: DateTime
): boolean =>
  Interval.fromDateTimes(range.start, range.end.endOf("day")).overlaps(
    Interval.fromDateTimes(from, to)
  );

// event mapping
const toDemandEvent = (range: SchoolBreakRange): DemandEventInput => {
  const startDate = range.start.toISODate() ?? "unknown";
  const endDate = range.end.toISODate() ?? "unknown";
  return {
    endsAt: Math.floor(range.end.endOf("day").toSeconds()),
    eventType: "school-break",
    location: "washington-state",
    pressure: SCHOOL_BREAK_PRESSURE,
    source: range.source,
    sourceId: `${range.source}-${range.kind}-${startDate}-${endDate}`,
    startsAt: Math.floor(range.start.startOf("day").toSeconds()),
    title: `Washington ${range.kind} school break`,
  };
};

// stale fallback cleanup
const removeStaleSchoolBreakEvents = async (
  startYear: number
): Promise<void> => {
  const startsAt = DateTime.fromObject(
    { day: 1, month: 8, year: startYear },
    { zone: SEATTLE_ZONE }
  ).toSeconds();
  const endsAt = DateTime.fromObject(
    { day: 1, month: 8, year: startYear + 1 },
    { zone: SEATTLE_ZONE }
  ).toSeconds();
  await DemandEvent.destroy({
    where: {
      eventType: "school-break",
      source: { [Op.in]: [GENERATED_BREAK_SOURCE, OSPI_BREAK_SOURCE] },
      startsAt: { [Op.gte]: startsAt, [Op.lt]: endsAt },
    },
  });
};

// school break update runner
export const updateSchoolBreakEvents = async ({
  fetchHtml = fetch,
  from,
  to,
}: SchoolBreakUpdateInput = {}): Promise<{
  eventsWritten: number;
  officialEvents: number;
}> => {
  const now = DateTime.local().setZone(SEATTLE_ZONE).startOf("day");
  const startDate = from ?? now.minus({ years: DEFAULT_YEARS_BACK });
  const endDate = to ?? now.plus({ years: DEFAULT_YEARS_AHEAD });
  const ranges: SchoolBreakRange[] = [];
  let officialEvents = 0;
  // school-year loop
  for (const startYear of getSchoolYearStarts(startDate, endDate)) {
    const officialRanges = await fetchOspiSchoolBreakRanges(
      startYear,
      fetchHtml
    );
    // official replacement guard
    if (officialRanges.length) {
      await removeStaleSchoolBreakEvents(startYear);
    }
    const selectedRanges = officialRanges.length
      ? officialRanges
      : getGeneratedSchoolBreakRanges(startYear);
    officialEvents += officialRanges.length;
    ranges.push(...selectedRanges);
  }
  const events = ranges.filter((range) =>
    overlapsRange(range, startDate, endDate)
  );
  await persistDemandEvents(events.map(toDemandEvent));
  logger.info(
    `Persisted ${events.length} school break events (${officialEvents} official ranges)`
  );
  return { eventsWritten: events.length, officialEvents };
};
