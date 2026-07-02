import terminalOverrides from "../data/terminals.json";
import wsfCore from "../data/wsf-core.json";

interface CoreRoute {
  description: string;
  terminalIds: string[];
}

interface CoreTerminal {
  abbreviation?: string;
  name: string;
}

interface DisplayTicketInput {
  description?: string;
  fallbackTitle: string;
  name?: string;
  plu?: string;
}

export interface DisplayTicketInfo {
  routeName?: string;
  subtitle?: string;
  title: string;
}

const MANUAL_ROUTE_CODES: Record<string, string> = {
  "an-fh": "Anacortes / Friday Harbor",
  "an-lo": "Anacortes / Lopez",
  "an-lpz": "Anacortes / Lopez",
  "an-or": "Anacortes / Orcas",
  "an-orc": "Anacortes / Orcas",
  "an-sh": "Anacortes / Shaw",
  "an-sj": "Anacortes / San Juan Islands",
  "ed-king": "Edmonds / Kingston",
  "f-s": "Fauntleroy / Southworth",
  "f-v": "Fauntleroy / Vashon Island",
  "f-v-s": "Fauntleroy / Vashon Island / Southworth",
  "fh-an": "Friday Harbor / Anacortes",
  "lo-an": "Lopez / Anacortes",
  "lpz-an": "Lopez / Anacortes",
  "mu-cl": "Mukilteo / Clinton",
  "muk-cl": "Mukilteo / Clinton",
  "or-an": "Orcas / Anacortes",
  "orc-an": "Orcas / Anacortes",
  "pd-tal": "Point Defiance / Tahlequah",
  "pd-tq": "Point Defiance / Tahlequah",
  "pt-coup": "Port Townsend / Coupeville",
  "pt-key": "Port Townsend / Coupeville",
  "s-v": "Southworth / Vashon Island",
  "sea-bi": "Seattle / Bainbridge Island",
  "sea-br": "Seattle / Bremerton",
  "sh-an": "Shaw / Anacortes",
  "v-f": "Vashon Island / Fauntleroy",
  "v-s": "Vashon Island / Southworth",
};

const TICKET_TERMINAL_CODES: Record<string, string> = {
  an: "Anacortes",
  ana: "Anacortes",
  bbg: "Bainbridge Island",
  bi: "Bainbridge Island",
  bmt: "Bremerton",
  br: "Bremerton",
  brem: "Bremerton",
  cl: "Clinton",
  cli: "Clinton",
  cou: "Coupeville",
  coup: "Coupeville",
  cpv: "Coupeville",
  ed: "Edmonds",
  edm: "Edmonds",
  f: "Fauntleroy",
  faunt: "Fauntleroy",
  fau: "Fauntleroy",
  fh: "Friday Harbor",
  frh: "Friday Harbor",
  key: "Coupeville",
  king: "Kingston",
  kin: "Kingston",
  kng: "Kingston",
  lo: "Lopez",
  lop: "Lopez",
  lpz: "Lopez",
  muk: "Mukilteo",
  mu: "Mukilteo",
  or: "Orcas",
  orc: "Orcas",
  pd: "Point Defiance",
  poi: "Point Defiance",
  pot: "Port Townsend",
  pt: "Port Townsend",
  ptd: "Point Defiance",
  sea: "Seattle",
  sh: "Shaw",
  sha: "Shaw",
  shi: "Shaw",
  sj: "San Juan Islands",
  sou: "Southworth",
  south: "Southworth",
  sw: "Southworth",
  swt: "Southworth",
  tah: "Tahlequah",
  tlq: "Tahlequah",
  tq: "Tahlequah",
  v: "Vashon Island",
  va: "Vashon Island",
  vas: "Vashon Island",
  vsh: "Vashon Island",
};

// normalized route code
const normalizeRouteCode = (code: string): string => {
  return code.trim().toLowerCase().replace(/[–—]/gu, "-");
};

// friendly terminal name
const getTerminalName = (terminalId: string): string => {
  const terminal = (wsfCore.terminals as Record<string, CoreTerminal>)[
    terminalId
  ];
  const override = (terminalOverrides as Record<string, Partial<CoreTerminal>>)[
    terminalId
  ];
  return (override?.name ?? terminal?.name ?? terminalId).trim();
};

// compact route name variant
const getShortRouteName = (routeName: string): string => {
  return routeName
    .replace(/\bIsland\b/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
};

// slash route label
const getRouteLabel = (terminalIds: string[]): string => {
  return terminalIds.map(getTerminalName).join(" / ");
};

// route code map
const getRouteCodeMap = (): Map<string, string> => {
  const routeCodes = new Map<string, string>(
    Object.entries(MANUAL_ROUTE_CODES)
  );
  Object.values(wsfCore.routes as Record<string, CoreRoute>).forEach(
    (route) => {
      const routeLabel = route.description.trim();
      const routeParts = route.description.split("/").map((part) => {
        return part.trim();
      });
      const routeCode = routeParts.map((part) => {
        return part
          .split(/\s+/u)
          .map((word) => word[0])
          .join("");
      });
      routeCodes.set(normalizeRouteCode(routeCode.join("-")), routeLabel);
      route.terminalIds.forEach((firstTerminalId) => {
        route.terminalIds.forEach((secondTerminalId) => {
          // identical terminal guard
          if (firstTerminalId === secondTerminalId) {
            return;
          }
          const firstTerminal = getTerminalName(firstTerminalId);
          const secondTerminal = getTerminalName(secondTerminalId);
          const terminalRouteLabel = `${firstTerminal} / ${secondTerminal}`;
          const firstCodes = Object.entries(TICKET_TERMINAL_CODES)
            .filter(([, name]) => name === firstTerminal)
            .map(([code]) => code);
          const secondCodes = Object.entries(TICKET_TERMINAL_CODES)
            .filter(([, name]) => name === secondTerminal)
            .map(([code]) => code);
          firstCodes.forEach((firstCode) => {
            secondCodes.forEach((secondCode) => {
              routeCodes.set(
                normalizeRouteCode(`${firstCode}-${secondCode}`),
                terminalRouteLabel
              );
            });
          });
        });
      });
    }
  );
  return routeCodes;
};

const ROUTE_CODE_MAP = getRouteCodeMap();
const ROUTE_NAME_PREFIXES = Array.from(
  new Set([
    ...Object.values(wsfCore.routes as Record<string, CoreRoute>).map((route) =>
      route.description.trim()
    ),
    ...Object.values(wsfCore.routes as Record<string, CoreRoute>).flatMap(
      (route) => {
        return route.terminalIds.flatMap((firstTerminalId) => {
          return route.terminalIds
            .filter((secondTerminalId) => secondTerminalId !== firstTerminalId)
            .map((secondTerminalId) => {
              return getRouteLabel([firstTerminalId, secondTerminalId]);
            });
        });
      }
    ),
  ])
).flatMap((routeName) => [routeName, getShortRouteName(routeName)]);

// regex literal escape
const escapeRegExp = (input: string): string => {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
};

// cleanup code markers
const stripTicketMarkers = (input: string): string => {
  return input
    .replace(/^\s*(?:\[[A-Z0-9 -]{1,8}\]\s*)+/giu, "")
    .replace(/\s*(?:\([A-Z0-9 -]{1,8}\)|\[[A-Z0-9 -]{1,8}\])\s*$/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
};

// cleanup ride counts
const stripRideCountDescriptions = (input: string): string => {
  return input
    .replace(
      /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|thirty-one)\s*[- ]?\s*rides?\b/giu,
      ""
    )
    .replace(/^\s*[-–—:/,]+\s*/gu, "")
    .replace(/\s*[-–—:/,]+\s*$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
};

// expand fare abbreviations
export const expandTicketText = (input: string): string => {
  return stripRideCountDescriptions(
    input
      .replace(/\bU14'/giu, "Under 14'")
      .replace(/\bU22'/giu, "Under 22'")
      .replace(/\bPsgr\b/giu, "Passenger")
      .replace(/\bSr\s*\/\s*Dis\b/giu, "Senior/Disability")
      .replace(/\bVeh\b/giu, "Vehicle")
      .replace(/\bDrv\b/giu, "Driver")
      .replace(/\s+/gu, " ")
      .trim()
  );
};

// route code prefix parser
const extractRouteCodePrefix = (
  input: string
): { routeName?: string; text: string } => {
  const match = input.match(
    /^([A-Za-z]{1,8}(?:[-–—][A-Za-z]{1,8}){1,2})\s+(.+)$/u
  );
  // route code guard
  if (!match) {
    return { text: input };
  }
  const [, routeCode, text] = match;
  const routeName = ROUTE_CODE_MAP.get(normalizeRouteCode(routeCode));
  // known route guard
  if (!routeName) {
    return { text: input };
  }
  return { routeName, text };
};

// route name prefix parser
const extractRouteNamePrefix = (
  input: string
): { routeName?: string; text: string } => {
  const matchedRouteName = ROUTE_NAME_PREFIXES.find((routeName) => {
    const routePattern = new RegExp(`^${escapeRegExp(routeName)}\\s+`, "iu");
    return routePattern.test(input);
  });
  // route name guard
  if (!matchedRouteName) {
    return { text: input };
  }
  const canonicalRouteName = ROUTE_NAME_PREFIXES.find((routeName) => {
    return getShortRouteName(routeName) === getShortRouteName(matchedRouteName);
  });
  return {
    routeName: canonicalRouteName ?? matchedRouteName,
    text: input.replace(
      new RegExp(`^${escapeRegExp(matchedRouteName)}\\s+`, "iu"),
      ""
    ),
  };
};

// parse route and clean fare text
export const parseTicketText = (
  input: string
): { routeName?: string; text: string } => {
  const withoutMarkers = stripTicketMarkers(input);
  const routeCodeResult = extractRouteCodePrefix(withoutMarkers);
  const routeNameResult = routeCodeResult.routeName
    ? routeCodeResult
    : extractRouteNamePrefix(withoutMarkers);
  return {
    routeName: routeNameResult.routeName,
    text: expandTicketText(stripTicketMarkers(routeNameResult.text)),
  };
};

// ticket display labels
export const getTicketDisplayInfo = ({
  description,
  fallbackTitle,
  name,
  plu,
}: DisplayTicketInput): DisplayTicketInfo => {
  const titleSource = description || fallbackTitle;
  const title = parseTicketText(titleSource);
  const subtitle = name ? parseTicketText(name).text : plu;
  const resolvedSubtitle = subtitle && subtitle !== title.text ? subtitle : plu;
  return {
    routeName: title.routeName,
    subtitle: resolvedSubtitle,
    title: title.text || fallbackTitle,
  };
};
