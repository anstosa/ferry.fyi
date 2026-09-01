import { DateTime } from "luxon";

import {
  type DemandEventInput,
  persistDemandEvents,
} from "~/lib/demandEvents/persistDemandEvents";
import logger from "~/lib/logger";

const DEFAULT_YEARS_AHEAD = 1;
const SEATTLE_ZONE = "America/Los_Angeles";
const SPORTS_EVENT_PRESSURE = 0.1;
const MLB_MARINERS_TEAM_ID = 136;
const ESPN_TEAMS = [
  {
    league: "nfl",
    name: "Seattle Seahawks",
    slug: "football/nfl",
    team: "sea",
  },
  {
    league: "nhl",
    name: "Seattle Kraken",
    slug: "hockey/nhl",
    team: "sea",
  },
  {
    league: "mls",
    name: "Seattle Sounders",
    slug: "soccer/usa.1",
    team: "9726",
  },
  {
    league: "wnba",
    name: "Seattle Storm",
    slug: "basketball/wnba",
    team: "sea",
  },
];

interface MlbGame {
  gamePk: number;
  gameDate: string;
  teams: {
    away: { team: { name: string } };
    home: { team: { id: number; name: string } };
  };
}

interface MlbScheduleDate {
  games: MlbGame[];
}

interface MlbScheduleResponse {
  dates?: MlbScheduleDate[];
}

interface EspnEvent {
  competitions?: Array<{
    competitors?: Array<{ homeAway?: string; team?: { displayName?: string } }>;
  }>;
  date?: string;
  id?: string;
  name?: string;
}

interface EspnScheduleResponse {
  events?: EspnEvent[];
}

// json fetch
const fetchJson = async <ResponseShape>(
  url: string
): Promise<ResponseShape> => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  // response guard
  if (!response.ok) {
    throw new Error(
      `Sports schedule request failed ${response.status}: ${url}`
    );
  }
  return (await response.json()) as ResponseShape;
};

// mariners schedule fetch
const getMarinersEvents = async (
  from: DateTime,
  to: DateTime
): Promise<DemandEventInput[]> => {
  const params = new URLSearchParams({
    endDate: to.toISODate() ?? "",
    sportId: "1",
    startDate: from.toISODate() ?? "",
    teamId: String(MLB_MARINERS_TEAM_ID),
  });
  const schedule = await fetchJson<MlbScheduleResponse>(
    `https://statsapi.mlb.com/api/v1/schedule?${params.toString()}`
  );
  return (schedule.dates ?? []).flatMap((date) => {
    return date.games
      .filter((game) => {
        return game.teams.home.team.id === MLB_MARINERS_TEAM_ID;
      })
      .map((game) => {
        const startsAt = DateTime.fromISO(game.gameDate, {
          zone: SEATTLE_ZONE,
        });
        return {
          endsAt: startsAt.plus({ hours: 4 }).toSeconds(),
          source: "mlb-stats-api",
          sourceId: `mlb-${game.gamePk}`,
          eventType: "sports",
          location: "seattle-stadium",
          pressure: SPORTS_EVENT_PRESSURE,
          startsAt: startsAt.toSeconds(),
          title: `${game.teams.away.team.name} at Seattle Mariners`,
        };
      });
  });
};

// home competition check
const isEspnHomeGame = (event: EspnEvent): boolean =>
  Boolean(
    event.competitions?.some((competition) => {
      return competition.competitors?.some((competitor) => {
        return competitor.homeAway === "home";
      });
    })
  );

// ESPN team schedule fetch
const getEspnEvents = async (
  from: DateTime,
  to: DateTime
): Promise<DemandEventInput[]> => {
  const years = new Set<number>([from.year, to.year]);
  const eventGroups = await Promise.all(
    ESPN_TEAMS.map(async (team) => {
      const teamEvents: DemandEventInput[] = [];
      // yearly schedule scan
      for (const year of years) {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${team.slug}/teams/${team.team}/schedule?dates=${year}`;
        try {
          const schedule = await fetchJson<EspnScheduleResponse>(url);
          // event loop
          (schedule.events ?? []).forEach((event) => {
            // home game guard
            if (!event.id || !event.date || !isEspnHomeGame(event)) {
              return;
            }
            const startsAt = DateTime.fromISO(event.date, {
              zone: SEATTLE_ZONE,
            });
            // range guard
            if (startsAt < from || startsAt > to) {
              return;
            }
            teamEvents.push({
              endsAt: startsAt.plus({ hours: 4 }).toSeconds(),
              eventType: "sports",
              location: "seattle-stadium",
              pressure: SPORTS_EVENT_PRESSURE,
              source: "espn-site-api",
              sourceId: `${team.league}-${event.id}`,
              startsAt: startsAt.toSeconds(),
              title: event.name ?? `${team.name} home game`,
            });
          });
        } catch (error) {
          logger.warn(`Skipped ${team.name} schedule: ${String(error)}`);
        }
      }
      return teamEvents;
    })
  );
  return eventGroups.flat();
};

export interface MajorSportsUpdateInput {
  from?: DateTime;
  to?: DateTime;
}

// sports update runner
export const updateMajorSportsEvents = async ({
  from,
  to,
}: MajorSportsUpdateInput = {}): Promise<{ eventsWritten: number }> => {
  const now = DateTime.local().setZone(SEATTLE_ZONE).startOf("day");
  const startDate = from ?? now.minus({ months: 1 });
  const endDate = to ?? now.plus({ years: DEFAULT_YEARS_AHEAD });
  const events = [
    ...(await getMarinersEvents(startDate, endDate)),
    ...(await getEspnEvents(startDate, endDate)),
  ];
  await persistDemandEvents(events);
  logger.info(`Persisted ${events.length} major sports events`);
  return { eventsWritten: events.length };
};
