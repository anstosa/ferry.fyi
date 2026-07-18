import { type Bulletin, Level } from "shared/contracts/bulletins";
import type { Terminal } from "shared/contracts/terminals";
import { isSuppressedBulletin } from "shared/lib/bulletins";

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
