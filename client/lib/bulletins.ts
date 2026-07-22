import { DateTime } from "luxon";
import { type Bulletin, Level } from "shared/contracts/bulletins";
import type { Terminal } from "shared/contracts/terminals";
import { isSuppressedBulletin } from "shared/lib/bulletins";
import { round } from "shared/lib/math";
import { capitalize } from "shared/lib/strings";

const WAIT_NUMBER_HOURS_MATCH = /^[^\d]*(\d+) (Hour|Hr) Wait.*$/i;
const WAIT_SPELL_HOURS_MATCH =
  /^.*(one|two|three|four|five|six)( 1\/2){0,1} (Hour|Hr) Wait.*$/i;
const WAIT_MINUTES_MATCH = /^[^\d]*(\d+) (Minute|Min) Wait.*$/i;
const HOURS_BY_SPELLED: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

// active bulletin guard
const isActiveBulletin = (bulletin: Bulletin): boolean => {
  if (bulletin.level === Level.LOW) {
    return false;
  }
  return !isSuppressedBulletin(bulletin);
};

// legacy bulletin body fallback
const getBulletinBodyText = (bulletin: Bulletin): string => {
  if (bulletin.bodyText) {
    return bulletin.bodyText;
  }
  const bodyHTML = bulletin.bodyHTML ?? "";
  const document = new DOMParser().parseFromString(bodyHTML, "text/html");
  return document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
};

// legacy API bulletin normalization
const normalizeBulletin = (bulletin: Bulletin): Bulletin => ({
  ...bulletin,
  bodyHTML: bulletin.bodyHTML ?? "",
  bodyText: getBulletinBodyText(bulletin),
  level: bulletin.level ?? Level.INFO,
  routePrefix: bulletin.routePrefix ?? "All",
});

// route bulletin key
const getBulletinKey = (bulletin: Bulletin): string => {
  // WSF repeats route-wide alerts in the feeds for both route terminals.
  // Terminal-specific URLs and slightly different updated times must not turn
  // that one alert into two cards.
  const normalize = (value: string): string =>
    value.replace(/\s+/g, " ").trim().toLowerCase();
  return [bulletin.level, bulletin.title, bulletin.bodyText]
    .map(normalize)
    .join(":");
};

// route bulletin filter
export const getRouteBulletins = (
  terminal: Terminal,
  mate: Terminal | null
): Bulletin[] => {
  const bulletinsByKey = new Map<string, Bulletin>();
  [terminal, mate]
    .filter((routeTerminal): routeTerminal is Terminal => {
      return Boolean(routeTerminal);
    })
    .forEach((routeTerminal) => {
      (routeTerminal.bulletins ?? [])
        .map(normalizeBulletin)
        .filter(isActiveBulletin)
        .forEach((bulletin) => {
          bulletinsByKey.set(getBulletinKey(bulletin), bulletin);
        });
    });
  return Array.from(bulletinsByKey.values()).sort((left, right) => {
    return right.date - left.date;
  });
};

export const getWaitTime = ({ title }: Bulletin): string | null => {
  let match = title.match(WAIT_NUMBER_HOURS_MATCH);
  if (match) {
    const [, hours] = match;
    return `${hours}hr wait`;
  }

  match = title.match(WAIT_SPELL_HOURS_MATCH);
  if (match) {
    const [, hours, minutes] = match;
    return `${HOURS_BY_SPELLED[hours.toLowerCase()]}${
      minutes === "1/2" ? ".5" : ""
    }hr wait`;
  }

  match = title.match(WAIT_MINUTES_MATCH);
  if (match) {
    const [, minutesString] = match;
    const minutes = Number(minutesString);
    return minutes >= 60 ? `${minutes / 60}hr wait` : `${minutes}min wait`;
  }
  return null;
};

export const getBulletinTime = (
  bulletin: Bulletin,
  now: DateTime = DateTime.local()
): string => {
  const time = DateTime.fromSeconds(bulletin.date);
  const diff = time.diff(now);
  if (Math.abs(diff.as("hours")) < 1) {
    const mins = round(Math.abs(diff.as("minutes")));
    return `${mins} min${mins > 1 ? "s" : ""} ago`;
  }
  if (time.hasSame(now, "day")) {
    return time.toFormat("h:mm a");
  }
  return capitalize(time.toRelativeCalendar() ?? "");
};

export const getLastBulletinTime = (terminal: Terminal): string =>
  getBulletinTime(terminal.bulletins[0]);
