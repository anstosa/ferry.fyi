import {
  type AdminTerminalLocation,
  type AdminTerminalLocationsResponse,
  isTerminalPoint,
  type TerminalLocationPoints,
  type TerminalPoint,
} from "shared/contracts/terminalLocations";
import type { Terminal } from "shared/contracts/terminals";
import TERMINALS from "shared/data/terminals.json";

export interface StoredTerminalLocations extends TerminalLocationPoints {
  terminalId: string;
  updatedAt: Date;
}

export interface TerminalLocationStore {
  list: () => Promise<StoredTerminalLocations[]>;
  read: (terminalId: string) => Promise<StoredTerminalLocations | null>;
  save: (
    terminalId: string,
    points: TerminalLocationPoints
  ) => Promise<StoredTerminalLocations>;
}

// expose only bounded validation errors to the owner ui
export class TerminalLocationValidationError extends Error {}

// validate a complete two-point replacement before any database mutation
export const parseTerminalLocations = (
  value: unknown
): TerminalLocationPoints | null => {
  // reject unexpected fields and malformed point pairs
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const input = value as TerminalLocationPoints;
  // explicit null clears a point without inventing a replacement
  if (
    Object.keys(input).sort().join(",") !== "booth,dock" ||
    (input.booth !== null && !isTerminalPoint(input.booth)) ||
    (input.dock !== null && !isTerminalPoint(input.dock))
  ) {
    return null;
  }
  return {
    booth: input.booth ? { ...input.booth } : null,
    dock: input.dock ? { ...input.dock } : null,
  };
};

// normalize nullable database columns without trusting corrupt stored points
const toStoredLocations = (row: {
  terminalId: string;
  boothLatitude: number | null;
  boothLongitude: number | null;
  dockLatitude: number | null;
  dockLongitude: number | null;
  updatedAt: Date;
}): StoredTerminalLocations => {
  const booth = { latitude: row.boothLatitude, longitude: row.boothLongitude };
  const dock = { latitude: row.dockLatitude, longitude: row.dockLongitude };
  return {
    terminalId: row.terminalId,
    booth: isTerminalPoint(booth) ? booth : null,
    dock: isTerminalPoint(dock) ? dock : null,
    updatedAt: row.updatedAt,
  };
};

// lazy model loading keeps disabled routing free of database work
const defaultStore: TerminalLocationStore = {
  // read current overrides across all application instances
  list: async () => {
    const { TerminalLocationSetting } =
      await import("~/models/TerminalLocationSetting");
    return (await TerminalLocationSetting.findAll()).map(toStoredLocations);
  },
  // resolve the current booth immediately before navigation
  read: async (terminalId) => {
    const { TerminalLocationSetting } =
      await import("~/models/TerminalLocationSetting");
    const row = await TerminalLocationSetting.findByPk(terminalId);
    return row ? toStoredLocations(row) : null;
  },
  // replace booth and dock together in one atomic upsert
  save: async (terminalId, points) => {
    const { TerminalLocationSetting } =
      await import("~/models/TerminalLocationSetting");
    const [row] = await TerminalLocationSetting.upsert({
      terminalId,
      boothLatitude: points.booth?.latitude ?? null,
      boothLongitude: points.booth?.longitude ?? null,
      dockLatitude: points.dock?.latitude ?? null,
      dockLongitude: points.dock?.longitude ?? null,
    });
    return toStoredLocations(row);
  },
};

// compose testable owner editing and public coordinate reads
export const createTerminalLocationService = (
  dependencies: {
    store?: TerminalLocationStore;
    getTerminals?: () => Promise<Terminal[]>;
  } = {}
) => {
  const store = dependencies.store ?? defaultStore;
  // retain upstream coordinates as the unset dock fallback
  const readTerminals =
    dependencies.getTerminals ??
    (async () => {
      const { Terminal: Model } = await import("~/models/Terminal");
      return Object.values(Model.getAll()).map((terminal) =>
        terminal.serialize({ withoutMates: true })
      );
    });
  // project one editable owner record without nested public terminal data
  const toAdmin = (
    terminal: Terminal,
    row?: StoredTerminalLocations | null
  ): AdminTerminalLocation => {
    const defaultDock = terminal.location
      ? {
          latitude: terminal.location.latitude,
          longitude: terminal.location.longitude,
        }
      : null;
    return {
      terminalId: terminal.id,
      name: terminal.name,
      abbreviation: terminal.abbreviation,
      defaultDock: isTerminalPoint(defaultDock) ? defaultDock : null,
      booth: row?.booth ?? null,
      dock: row?.dock ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  };
  return {
    // list every canonical terminal even before its points have been set
    list: async (): Promise<AdminTerminalLocationsResponse> => {
      const [terminals, rows] = await Promise.all([
        readTerminals(),
        store.list(),
      ]);
      const byId = new Map(rows.map((row) => [row.terminalId, row]));
      return {
        terminals: terminals
          .filter((terminal) =>
            Object.prototype.hasOwnProperty.call(TERMINALS, terminal.id)
          )
          .map((terminal) => toAdmin(terminal, byId.get(terminal.id)))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    // reject unknown ids and invalid payloads before writing
    save: async (
      terminalId: string,
      value: unknown
    ): Promise<AdminTerminalLocation> => {
      const points = parseTerminalLocations(value);
      // constrain mutations to canonical terminal identities
      if (
        !Object.prototype.hasOwnProperty.call(TERMINALS, terminalId) ||
        !points
      ) {
        throw new TerminalLocationValidationError("Invalid terminal locations");
      }
      const terminal = (await readTerminals()).find(
        (item) => item.id === terminalId
      );
      // do not create settings for a missing upstream terminal
      if (!terminal) {
        throw new TerminalLocationValidationError("Terminal unavailable");
      }
      return toAdmin(terminal, await store.save(terminalId, points));
    },
    // no dock or generic terminal coordinate is a navigation fallback
    getBooth: async (terminalId: string): Promise<TerminalPoint | null> =>
      (await store.read(terminalId))?.booth ?? null,
    // read current map overrides without leaking owner timestamps or booths
    getDocks: async (): Promise<Record<string, TerminalPoint>> =>
      Object.fromEntries(
        (await store.list())
          .filter((row) => row.dock !== null)
          .map((row) => [row.terminalId, row.dock as TerminalPoint])
      ),
  };
};

export const terminalLocationService = createTerminalLocationService();

// overlay public map coordinates without mutating the refreshed wsf cache
export const applyTerminalDocks = (
  terminal: Terminal,
  docks: Record<string, TerminalPoint>
): Terminal => {
  const dock = docks[terminal.id];
  return {
    ...terminal,
    ...(dock ? { location: { ...terminal.location, ...dock } } : {}),
    ...(terminal.mates
      ? {
          mates: terminal.mates.map((mate) => applyTerminalDocks(mate, docks)),
        }
      : {}),
  };
};
