import clsx from "clsx";
import { DateTime } from "luxon";
import React, {
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  FareCatalogApiResponse,
  FareQuoteApiResponse,
  FareQuoteRequest,
  FareTotal,
  FareTripRequest,
} from "shared/contracts/fares";
import type { Terminal } from "shared/contracts/terminals";
import { getQuotedFareRates } from "shared/lib/fareDefaults";

import { AdSlot } from "~/components/AdSlot";
import { DateButton } from "~/components/DateButton";
import { ExternalPillLink } from "~/components/ExternalPillLink";
import { FareCatalogDisclosure } from "~/components/FareCatalogDisclosure";
import { CUSTOM_FARE_SECTION_CLASS } from "~/components/FareLoadingContent";
import {
  FarePriceComparison,
  FareRatesOverview,
} from "~/components/FareRatesOverview";
import { FareWizardIcon, fareWizardIcons } from "~/components/FareWizardIcons";
import { RoutePageIntro } from "~/components/RoutePageIntro";
import { RoutePlanningLinks } from "~/components/RoutePlanningLinks";
import { RouteSelector } from "~/components/RouteSelector";
import { trackUsefulEvent } from "~/lib/analytics";
import { getFareCatalog, getFareQuote } from "~/lib/fares";
import {
  createFareWizardSelections,
  FareTravelMode,
  FareVehicleType,
  FareWizardConfig,
  parseFareWizardConfig,
  withFareWizardConfig,
} from "~/lib/fareWizard";
import { usePublicSsrSource } from "~/lib/ssrSeed";
import { useUsefulContent } from "~/lib/usefulVisits";
import ShareIcon from "~/static/images/icons/solid/share-alt.svg";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import { Header } from "~/views/Header";

interface Props {
  date: DateTime;
  mate: Terminal;
  setDate: (date: DateTime) => void;
  setRoute: (terminalSlug: string, mateSlug?: string) => Promise<void>;
  terminal: Terminal;
}

const WSDOT_FARE_CALCULATOR_URL = "https://wsdot.wa.gov/ferries/fares/";
const WSDOT_REDUCED_FARE_URL =
  "https://wsdot.wa.gov/ferries/rider-information/ada#Reduced%20fare%20passenger%20tickets";

// distinguish deliberate configuration and retry requests locally
type FareQuoteCause = "user_config" | "user_retry";

// bind one consumed cause to its concrete active request
interface FareQuoteProvenance {
  cause: FareQuoteCause;
  configVersion: number;
  requestId: number;
  scope: string;
}

// hold one deliberate cause until the quote effect creates its request
interface PendingFareQuoteCause {
  cause: FareQuoteCause;
  configVersion: number;
  scope: string;
}

interface ScopedCatalogResponse {
  response: FareCatalogApiResponse;
  scope: string;
}

interface ScopedCatalogError {
  error: Error;
  scope: string;
}

interface ScopedQuoteResponse {
  request: FareQuoteRequest;
  response: FareQuoteApiResponse;
  scope: string;
}

interface ScopedQuoteError {
  error: Error;
  request: FareQuoteRequest;
  scope: string;
}

// match one fare response to the route and service date on screen
const matchesFareTripRequest = (
  request: FareTripRequest,
  terminal: Terminal,
  mate: Terminal,
  date: DateTime
): boolean => {
  const tripDate = date.toISODate();
  return Boolean(
    tripDate &&
    request.departingTerminalId === terminal.id &&
    request.arrivingTerminalId === mate.id &&
    request.tripDate === tripDate &&
    typeof request.roundTrip === "boolean"
  );
};

// normalize fare selections to the server's id-to-quantity representation
const fareLineItemQuantities = (
  lineItems: FareQuoteRequest["lineItems"]
): Map<number, number> | null => {
  const quantities = new Map<number, number>();
  // aggregate duplicate ids without changing the caller-owned request
  for (const lineItem of lineItems) {
    // reject malformed ids or quantities before comparing requests
    if (
      !Number.isInteger(lineItem.fareLineItemId) ||
      lineItem.fareLineItemId <= 0 ||
      !Number.isInteger(lineItem.quantity) ||
      lineItem.quantity < 0
    ) {
      return null;
    }
    // match the server's omission of zero-quantity selections
    if (lineItem.quantity === 0) {
      continue;
    }
    quantities.set(
      lineItem.fareLineItemId,
      (quantities.get(lineItem.fareLineItemId) ?? 0) + lineItem.quantity
    );
  }
  return quantities;
};

// compare normalized quote inputs independently of server sorting
const matchesFareQuoteInputs = (
  echoed: FareQuoteRequest,
  request: FareQuoteRequest
): boolean => {
  // reject a response from another route, date or trip type
  if (
    echoed.departingTerminalId !== request.departingTerminalId ||
    echoed.arrivingTerminalId !== request.arrivingTerminalId ||
    echoed.tripDate !== request.tripDate ||
    echoed.roundTrip !== request.roundTrip
  ) {
    return false;
  }
  const echoedQuantities = fareLineItemQuantities(echoed.lineItems);
  const requestedQuantities = fareLineItemQuantities(request.lineItems);
  // reject malformed or differently sized normalized selections
  if (
    !echoedQuantities ||
    !requestedQuantities ||
    echoedQuantities.size !== requestedQuantities.size
  ) {
    return false;
  }
  // compare normalized quantities independently of server sorting
  for (const [fareLineItemId, quantity] of requestedQuantities) {
    // require the same total quantity for every selected fare id
    if (echoedQuantities.get(fareLineItemId) !== quantity) {
      return false;
    }
  }
  return true;
};

// require the returned quote to echo the concrete request that produced it
const matchesFareQuoteRequest = (
  response: FareQuoteApiResponse,
  request: FareQuoteRequest
): boolean => {
  // only usable quote states carry a complete quote request echo
  if (
    (response.state !== "current" && response.state !== "stale") ||
    !response.quote.request ||
    !Array.isArray(response.quote.request.lineItems)
  ) {
    return false;
  }
  return matchesFareQuoteInputs(response.quote.request, request);
};

// require an echoed no-fare trip to match the active quote request
const matchesFareQuoteTrip = (
  echoed: FareTripRequest,
  request: FareQuoteRequest
): boolean =>
  echoed.departingTerminalId === request.departingTerminalId &&
  echoed.arrivingTerminalId === request.arrivingTerminalId &&
  echoed.tripDate === request.tripDate &&
  echoed.roundTrip === request.roundTrip;

// accept the catalog for this exact route and date with its source-owned trip mode
const getMatchingSeededCatalog = (
  response: FareCatalogApiResponse | undefined,
  terminal: Terminal,
  mate: Terminal,
  date: DateTime
): FareCatalogApiResponse | undefined => {
  // unavailable responses carry no request identity
  if (!response || response.state === "unavailable") {
    return undefined;
  }
  const request =
    response.state === "current"
      ? response.catalog.request
      : response.noFare.request;
  // prevent a persistent page seed from crossing request scopes
  if (!matchesFareTripRequest(request, terminal, mate, date)) {
    return undefined;
  }
  return response;
};

// expose only a response committed for the route and date on screen
const getMatchingCatalogResponse = (
  scoped: ScopedCatalogResponse | null,
  scope: string,
  terminal: Terminal,
  mate: Terminal,
  date: DateTime
): FareCatalogApiResponse | null => {
  // fail closed across route and date transitions
  if (!scoped || scoped.scope !== scope) {
    return null;
  }
  // unavailable responses are bound by the explicit request scope
  if (scoped.response.state === "unavailable") {
    return scoped.response;
  }
  const request =
    scoped.response.state === "current"
      ? scoped.response.catalog.request
      : scoped.response.noFare.request;
  return matchesFareTripRequest(request, terminal, mate, date)
    ? scoped.response
    : null;
};

// expose only a response for the active configuration and fare scope
const getMatchingQuoteResponse = (
  scoped: ScopedQuoteResponse | null,
  request: FareQuoteRequest | null,
  scope: string
): FareQuoteApiResponse | null => {
  // hide old configuration and route responses before passive cleanup runs
  if (
    !scoped ||
    !request ||
    scoped.scope !== scope ||
    !matchesFareQuoteInputs(scoped.request, request)
  ) {
    return null;
  }
  // priced responses must echo the exact active request
  if (
    scoped.response.state === "current" ||
    scoped.response.state === "stale"
  ) {
    return matchesFareQuoteRequest(scoped.response, request)
      ? scoped.response
      : null;
  }
  // no-fare responses still carry route, date and trip-mode identity
  if (scoped.response.state === "no-fare") {
    return matchesFareQuoteTrip(scoped.response.noFare.request, request)
      ? scoped.response
      : null;
  }
  return scoped.response;
};

const getTotal = (totals: FareTotal[]): FareTotal | undefined =>
  totals.find(({ type }) => type === "total");

const getWizardStep = (config: FareWizardConfig): number => {
  if (!config.travelMode) {
    return 0;
  }
  if (config.travelMode !== "vehicle") {
    return 4;
  }
  if (config.isSeniorOrDisabledDriver === undefined) {
    return 1;
  }
  if (!config.vehicleType) {
    return 2;
  }
  if (
    config.vehicleType === "tall-or-long" &&
    config.vehicleLength === undefined
  ) {
    return 3;
  }
  return 4;
};

const getTravelModeAnswer = (
  travelMode: FareTravelMode
): { Icon: FareWizardIcon; answer: string } => {
  switch (travelMode) {
    case "bicycle":
      return { Icon: fareWizardIcons.bicycle, answer: "Bicycle" };
    case "walk-on":
      return { Icon: fareWizardIcons.walking, answer: "Walk on" };
    case "vehicle":
      return { Icon: fareWizardIcons.car, answer: "Vehicle" };
  }
};

const getVehicleTypeAnswer = (
  vehicleType: FareVehicleType
): { Icon: FareWizardIcon; answer: string } => {
  switch (vehicleType) {
    case "motorcycle":
      return { Icon: fareWizardIcons.motorcycle, answer: "Motorcycle" };
    case "short":
      return { Icon: fareWizardIcons.carSide, answer: "Short" };
    case "standard":
      return { Icon: fareWizardIcons.car, answer: "Standard" };
    case "tall-or-long":
      return { Icon: fareWizardIcons.truck, answer: "Tall or long" };
  }
};

const getVehicleTypeDescription = (
  vehicleType: FareVehicleType
): React.ReactNode => {
  if (vehicleType === "tall-or-long") {
    return (
      <>
        Taller than 7'2" or <br />
        longer than 22'
      </>
    );
  }
  if (vehicleType === "short") {
    return "Under 14'";
  }
};

// keep loading, unavailable and no-fare content in the same unboxed page layout
const FarePageState = ({
  children,
}: {
  children: React.ReactNode;
}): ReactElement => (
  <main className="flex-grow overflow-y-auto bg-day-normal-light text-gray-dark motion-safe:scroll-smooth dark:bg-night-normal-dark dark:text-[#e0f0f4]">
    <div className="mx-auto w-full max-w-6xl p-4">{children}</div>
  </main>
);

const CalculatorLink = ({ href }: { href: string }): ReactElement => (
  <ExternalPillLink className="mt-4" href={href}>
    Open WSDOT fare calculator
  </ExternalPillLink>
);

const RetryButton = ({ onClick }: { onClick: () => void }): ReactElement => (
  <button
    className="button button-secondary button-small mt-4"
    onClick={onClick}
    type="button"
  >
    Retry
  </button>
);

const Option = ({
  active,
  children,
  description,
  Icon,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  description?: React.ReactNode;
  Icon: FareWizardIcon;
  onClick: () => void;
}): ReactElement => (
  <button
    aria-pressed={active}
    className={clsx(
      "flex min-h-32 flex-col items-center justify-center rounded-xl border px-3 py-4 text-center font-medium transition",
      active
        ? "border-green-dark bg-green-dark text-white"
        : "border-black/15 bg-white hover:border-green-dark dark:border-white/20 dark:bg-black/20"
    )}
    onClick={onClick}
    type="button"
  >
    <Icon className="mb-2 h-10 w-10" aria-hidden="true" />
    <span>{children}</span>
    {description && (
      <span className="mt-1 text-xs font-normal opacity-80">{description}</span>
    )}
  </button>
);

const Answer = ({
  answer,
  Icon,
  onClick,
  question,
}: {
  answer: string;
  Icon: FareWizardIcon;
  onClick: () => void;
  question: string;
}): ReactElement => (
  <button
    className="flex w-full items-center gap-3 rounded-xl border border-black/10 bg-black/5 p-3 text-left transition hover:border-green-dark hover:bg-green-lightest dark:border-white/10 dark:bg-black/20 dark:hover:bg-lighten-lower"
    onClick={onClick}
    type="button"
  >
    <Icon className="h-7 w-7 shrink-0 text-green-dark dark:text-green-light" />
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-65">
        {question}
      </p>
      <p className="font-bold">{answer}</p>
    </div>
  </button>
);

const Counter = ({
  description,
  label,
  min = 0,
  onChange,
  value,
}: {
  description?: React.ReactNode;
  label: string;
  min?: number;
  onChange: (value: number) => void;
  value: number;
}): ReactElement => {
  const [inputValue, setInputValue] = useState(String(value));

  useEffect(() => setInputValue(String(value)), [value]);

  const update = (next: number): void => {
    const normalized = Math.max(min, next);
    setInputValue(String(normalized));
    onChange(normalized);
  };

  const commitInput = (): void => {
    const parsed = Number(inputValue);
    update(Number.isInteger(parsed) ? parsed : min);
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="font-medium">{label}</span>
        {description && <p className="text-xs opacity-75">{description}</p>}
      </div>
      <div className="flex shrink-0 overflow-hidden rounded-lg border border-black/15 dark:border-white/20">
        <button
          aria-label={`Decrease ${label}`}
          className="h-10 w-10 text-xl disabled:opacity-40"
          disabled={value <= min}
          onClick={() => update(value - 1)}
          type="button"
        >
          −
        </button>
        <input
          aria-label={`${label} count`}
          className="h-10 w-10 border-x border-black/15 bg-transparent px-1 text-center font-bold dark:border-white/20"
          inputMode="numeric"
          onBlur={commitInput}
          onChange={(event) => {
            const next = event.target.value;
            setInputValue(next);
            if (/^\d+$/.test(next)) {
              update(Number(next));
            }
          }}
          pattern="[0-9]*"
          value={inputValue}
        />
        <button
          aria-label={`Increase ${label}`}
          className="h-10 w-10 text-xl"
          onClick={() => update(value + 1)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
};

// enhance the public catalog with live quoting
export const Fares = ({
  date,
  mate,
  setDate,
  setRoute,
  terminal,
}: Props): ReactElement => {
  const seededCatalog = getMatchingSeededCatalog(
    usePublicSsrSource("fares"),
    terminal,
    mate,
    date
  );
  const location = useLocation();
  const navigate = useNavigate();
  const { search } = location;
  const fareScope = `${terminal.id}:${mate.id}:${date.toISODate() ?? ""}`;
  const [scopedCatalogResponse, setScopedCatalogResponse] =
    useState<ScopedCatalogResponse | null>(() =>
      seededCatalog ? { response: seededCatalog, scope: fareScope } : null
    );
  const [scopedCatalogError, setScopedCatalogError] =
    useState<ScopedCatalogError | null>(null);
  const [isLoadingCatalog, setLoadingCatalog] = useState(!seededCatalog);
  const [isQuoting, setQuoting] = useState(false);
  const [scopedQuoteError, setScopedQuoteError] =
    useState<ScopedQuoteError | null>(null);
  const [scopedQuoteResponse, setScopedQuoteResponse] =
    useState<ScopedQuoteResponse | null>(null);
  const [config, setConfig] = useState<FareWizardConfig>(() =>
    parseFareWizardConfig(search)
  );
  const [isShareCopied, setShareCopied] = useState(false);
  // wait for the existing placement readiness signal before restoring a deep link
  const [isAdReady, setAdReady] = useState(false);
  const adReadyRef = useRef(false);
  const initialHashRef = useRef<string | undefined>(undefined);
  const restoredAnchorRef = useRef<HTMLElement | null>(null);
  const [wizardStep, setWizardStep] = useState(() =>
    getWizardStep(parseFareWizardConfig(search))
  );
  const catalogRequestRef = useRef(0);
  const catalogScopeRef = useRef<string | null>(null);
  const scopedCatalogResponseRef = useRef(scopedCatalogResponse);
  const catalogRetryRef = useRef({ attempts: 0, scope: "" });
  const quoteRequestRef = useRef(0);
  const quoteConfigVersionRef = useRef(0);
  const pendingQuoteCauseRef = useRef<PendingFareQuoteCause | null>(null);
  const activeQuoteProvenanceRef = useRef<FareQuoteProvenance | null>(null);
  const currentQuoteScopeRef = useRef(fareScope);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const catalogResponse = getMatchingCatalogResponse(
    scopedCatalogResponse,
    fareScope,
    terminal,
    mate,
    date
  );
  const catalogError =
    scopedCatalogError?.scope === fareScope ? scopedCatalogError.error : null;
  const isCatalogPending = Boolean(
    isLoadingCatalog ||
    (catalogScopeRef.current !== null &&
      catalogScopeRef.current !== fareScope) ||
    (scopedCatalogResponse && scopedCatalogResponse.scope !== fareScope)
  );
  // expose the latest usable catalog to later same-scope refresh completions
  useLayoutEffect(() => {
    scopedCatalogResponseRef.current = scopedCatalogResponse;
  }, [scopedCatalogResponse]);
  // expose only the committed scope to asynchronous quote completions
  useLayoutEffect(() => {
    currentQuoteScopeRef.current = fareScope;
  }, [fareScope]);
  const fareContentReady = Boolean(
    !isCatalogPending &&
    (catalogResponse?.state === "current" ||
      catalogResponse?.state === "no-fare")
  );
  const usefulContentRef = useUsefulContent(
    "fare",
    `fare:${fareScope}`,
    fareContentReady
  );
  // invalidate readiness synchronously when a branch mounts a replacement placement
  const handleAdReadyChange = useCallback((ready: boolean): void => {
    adReadyRef.current = ready;
    setAdReady(ready);
  }, []);
  // restore initial links instantly so browser anchoring can track late content above them
  useEffect(() => {
    initialHashRef.current ??= window.location.hash;
    // native clicks handle later jumps and unrelated fragments remain untouched
    if (
      !isAdReady ||
      !adReadyRef.current ||
      !fareContentReady ||
      initialHashRef.current !== window.location.hash ||
      window.location.hash !== "#custom-fare-calculator"
    ) {
      return;
    }
    const target = document.getElementById("custom-fare-calculator");
    // replacement scrollers restore once while quote and configuration updates stay put
    if (!target || restoredAnchorRef.current === target) {
      return;
    }
    restoredAnchorRef.current = target;
    target.scrollIntoView?.({ behavior: "instant", block: "start" });
  }, [isAdReady, fareContentReady, fareScope, catalogResponse?.state]);

  useEffect(() => {
    const scope = fareScope;
    const previousScope = catalogScopeRef.current;
    const isInitialSeedScope = previousScope === null;
    const isSameScope = previousScope === scope;
    catalogScopeRef.current = scope;
    if (catalogRetryRef.current.scope !== scope) {
      catalogRetryRef.current = { attempts: 0, scope };
    }
    const requestId = catalogRequestRef.current + 1;
    catalogRequestRef.current = requestId;
    if (!isInitialSeedScope) {
      setLoadingCatalog(true);
    }
    setScopedCatalogError(null);
    // retain usable prices during same-scope and seeded refreshes
    if (!isInitialSeedScope && !isSameScope) {
      setScopedCatalogResponse(null);
    }
    getFareCatalog(terminal, mate, date)
      .then((response) => {
        // ignore superseded responses
        if (requestId !== catalogRequestRef.current) {
          return;
        }
        const retainedResponse = scopedCatalogResponseRef.current;
        // retain usable same-scope data only for transient source failure
        if (
          response.state === "unavailable" &&
          response.reason === "unavailable" &&
          retainedResponse?.scope === scope &&
          (retainedResponse.response.state === "current" ||
            retainedResponse.response.state === "no-fare")
        ) {
          setScopedCatalogError({
            error: new Error("Live fare refresh unavailable"),
            scope,
          });
          return;
        }
        setScopedCatalogResponse({ response, scope });
      })
      .catch((error: unknown) => {
        // bind failures to the request scope that produced them
        if (requestId === catalogRequestRef.current) {
          setScopedCatalogError({
            error: error instanceof Error ? error : new Error(String(error)),
            scope,
          });
        }
      })
      .finally(
        () =>
          requestId === catalogRequestRef.current && setLoadingCatalog(false)
      );
  }, [catalogRetry, date, fareScope, mate, terminal]);

  useEffect(() => {
    if (
      catalogResponse?.state !== "unavailable" ||
      catalogRetryRef.current.attempts >= 1
    ) {
      return;
    }
    // Recover from a transient server restart without turning an unavailable
    // route into a recurring live WSDOT request.
    catalogRetryRef.current.attempts += 1;
    const timeout = window.setTimeout(() => {
      setCatalogRetry((current) => current + 1);
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [catalogResponse]);

  useEffect(() => {
    const sync = (): void => {
      const next = parseFareWizardConfig(window.location.search);
      // history restoration invalidates every user-originated quote cause
      quoteConfigVersionRef.current += 1;
      quoteRequestRef.current += 1;
      pendingQuoteCauseRef.current = null;
      activeQuoteProvenanceRef.current = null;
      setConfig(next);
      setWizardStep(getWizardStep(next));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // bind a user configuration edit to its next concrete quote request
  const setConfiguration = (next: FareWizardConfig): void => {
    const configVersion = quoteConfigVersionRef.current + 1;
    quoteConfigVersionRef.current = configVersion;
    pendingQuoteCauseRef.current = {
      cause: "user_config",
      configVersion,
      scope: fareScope,
    };
    activeQuoteProvenanceRef.current = null;
    const nextSearch = withFareWizardConfig(location.search, next);
    navigate(
      {
        hash: location.hash,
        pathname: location.pathname,
        search: `?${nextSearch}`,
      },
      { replace: true, state: location.state }
    );
    setConfig(next);
  };
  const updateConfig = <Key extends keyof FareWizardConfig>(
    key: Key,
    value: FareWizardConfig[Key]
  ): void => setConfiguration({ ...config, [key]: value });
  const restart = (): void => {
    setConfiguration({
      adultPassengers: 0,
      childPassengers: 0,
      seniorPassengers: 0,
    });
    setWizardStep(0);
  };
  const retryCatalog = (): void => {
    setCatalogRetry((current) => current + 1);
  };
  const retryQuote = (): void => {
    // bind the retry intent only to the request it starts
    pendingQuoteCauseRef.current = {
      cause: "user_retry",
      configVersion: quoteConfigVersionRef.current,
      scope: fareScope,
    };
    activeQuoteProvenanceRef.current = null;
    setQuoteRetry((current) => current + 1);
  };
  const catalog =
    catalogResponse?.state === "current" ? catalogResponse.catalog : null;
  const selection = useMemo(
    () => catalog && createFareWizardSelections(catalog.fares, config),
    [catalog, config]
  );
  const quoteRequest = useMemo<FareQuoteRequest | null>(() => {
    // wait for an exact catalog selection before requesting a quote
    if (!selection?.ok) {
      return null;
    }
    return {
      arrivingTerminalId: mate.id,
      departingTerminalId: terminal.id,
      lineItems: selection.lineItems,
      roundTrip: catalog?.request.roundTrip ?? false,
      tripDate: date.toISODate() as FareQuoteRequest["tripDate"],
    };
  }, [catalog?.request.roundTrip, date, mate.id, selection, terminal.id]);
  const quoteResponse = getMatchingQuoteResponse(
    scopedQuoteResponse,
    quoteRequest,
    fareScope
  );
  const quoteError =
    scopedQuoteError &&
    quoteRequest &&
    scopedQuoteError.scope === fareScope &&
    matchesFareQuoteInputs(scopedQuoteError.request, quoteRequest)
      ? scopedQuoteError.error
      : null;

  useEffect(() => {
    quoteRequestRef.current += 1;
    const requestId = quoteRequestRef.current;
    const configVersion = quoteConfigVersionRef.current;
    const pendingCause = pendingQuoteCauseRef.current;
    // consume provenance at request creation rather than a later response
    pendingQuoteCauseRef.current = null;
    activeQuoteProvenanceRef.current = null;
    setScopedQuoteResponse(null);
    setScopedQuoteError(null);
    // invalid selections consume their cause without starting a request
    if (!quoteRequest) {
      setQuoting(false);
      return;
    }
    // retain only a cause for this exact render scope and configuration
    if (
      pendingCause?.scope === fareScope &&
      pendingCause.configVersion === configVersion
    ) {
      activeQuoteProvenanceRef.current = {
        ...pendingCause,
        requestId,
      };
    }
    setQuoting(true);
    getFareQuote(quoteRequest)
      .then((response) => {
        // ignore obsolete requests and responses from another rendered scope
        if (
          requestId !== quoteRequestRef.current ||
          currentQuoteScopeRef.current !== fareScope
        ) {
          return;
        }
        setScopedQuoteResponse({
          request: quoteRequest,
          response,
          scope: fareScope,
        });
        const provenance = activeQuoteProvenanceRef.current;
        const usableQuote =
          response.state === "current" || response.state === "stale"
            ? {
                freshness: response.state,
                total: getTotal(response.quote.totals),
              }
            : null;
        const ownsProvenance =
          provenance?.requestId === requestId &&
          provenance.configVersion === configVersion &&
          provenance.scope === fareScope;
        // consume every settled user-bound request before evaluating its result
        if (ownsProvenance) {
          activeQuoteProvenanceRef.current = null;
        }
        // qualify only the active user-bound request with a matching usable total
        if (
          ownsProvenance &&
          usableQuote?.total &&
          matchesFareQuoteRequest(response, quoteRequest)
        ) {
          trackUsefulEvent("fare_quote_available", {
            freshness: usableQuote.freshness,
          });
        }
      })
      .catch((error: unknown) => {
        // settle only the current request without preserving its cause
        if (requestId === quoteRequestRef.current) {
          activeQuoteProvenanceRef.current = null;
          setScopedQuoteError({
            error:
              error instanceof Error
                ? error
                : new Error("Fare quote could not load."),
            request: quoteRequest,
            scope: fareScope,
          });
        }
      })
      .finally(() => {
        // stop the spinner only for the active request
        if (requestId === quoteRequestRef.current) {
          setQuoting(false);
        }
      });
    // invalidate late completions after replacement or unmount
    return () => {
      if (activeQuoteProvenanceRef.current?.requestId === requestId) {
        activeQuoteProvenanceRef.current = null;
      }
      if (quoteRequestRef.current === requestId) {
        quoteRequestRef.current += 1;
      }
    };
  }, [fareScope, quoteRequest, quoteRetry]);

  const share = async (): Promise<void> => {
    const title = `Fare estimate for ${terminal.name} to ${mate.name}`;
    try {
      const { Share } = await import("@capacitor/share");
      const { value: canShare } = await Share.canShare();
      if (canShare) {
        await Share.share({
          dialogTitle: title,
          text: title,
          title,
          url: window.location.href,
        });
        trackUsefulEvent("share_completed", {
          method: "share_sheet",
          surface: "fare",
        });
        return;
      }
      // qualify clipboard sharing only after an available write resolves
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
        trackUsefulEvent("share_completed", {
          method: "clipboard",
          surface: "fare",
        });
      }
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2500);
    } catch (error) {
      console.error("Failed to share fare configuration", error);
    }
  };

  // keep the same directional placement between standard rates and customization
  const fareAd = (
    <AdSlot
      arrivalTerminalId={mate.id}
      contextLabel={`Fares · ${terminal.name} to ${mate.name}`}
      departureTerminalId={terminal.id}
      onReadyChange={handleAdReadyChange}
      slot="fare"
    />
  );

  const header = (
    <Header
      items={
        terminal.terminalUrl
          ? [
              {
                Icon: WSDOTIcon,
                isBottom: true,
                label: "WSF Fare Page",
                url: terminal.terminalUrl,
              },
            ]
          : []
      }
    >
      <div className="relative flex flex-1 items-center justify-center">
        <div className="-translate-x-5 flex min-w-0 items-center justify-center whitespace-nowrap">
          <RouteSelector mate={mate} setRoute={setRoute} terminal={terminal} />
        </div>
        <div className="absolute right-0">
          <DateButton defaultDate={date} onDateChange={setDate} />
        </div>
      </div>
    </Header>
  );
  if (catalogError && !catalogResponse) {
    return (
      <>
        {header}
        <FarePageState>
          <RoutePageIntro title="Fares unavailable" />
          <RoutePlanningLinks
            currentView="fare"
            includeCustomFare={false}
            mate={mate}
            selectedDate={date.toISODate() ?? undefined}
            terminal={terminal}
          />
          <p className="mt-2">Fare information could not load right now.</p>
          <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
          <RetryButton onClick={retryCatalog} />
        </FarePageState>
      </>
    );
  }
  if (catalogResponse?.state === "unavailable") {
    return (
      <>
        {header}
        <FarePageState>
          <RoutePageIntro title="Fares unavailable" />
          <RoutePlanningLinks
            currentView="fare"
            includeCustomFare={false}
            mate={mate}
            selectedDate={date.toISODate() ?? undefined}
            terminal={terminal}
          />
          <p className="mt-2">
            Current fare information is not available for this route and date.
          </p>
          <CalculatorLink href={catalogResponse.calculatorUrl} />
          <RetryButton onClick={retryCatalog} />
        </FarePageState>
      </>
    );
  }
  if (catalogResponse?.state === "no-fare") {
    return (
      <>
        {header}
        <FarePageState>
          <div className="space-y-4" ref={usefulContentRef}>
            <FareRatesOverview
              response={catalogResponse}
              departingName={terminal.name}
              arrivingName={mate.name}
              mate={mate}
              terminal={terminal}
            />
            {fareAd}
            <section
              id="custom-fare-calculator"
              className={CUSTOM_FARE_SECTION_CLASS}
            >
              <h2 className="text-xl font-bold">Calculate a custom fare</h2>
              <p className="mt-2">
                No fare is collected for this departure. Use WSDOT’s calculator
                for a custom return journey or different travel dates.
              </p>
              <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
            </section>
          </div>
        </FarePageState>
      </>
    );
  }
  // reserve the unavailable fallback for a settled request without usable data
  if (!catalog && !isCatalogPending) {
    return (
      <>
        {header}
        <FarePageState>
          <RoutePageIntro title="Fares unavailable" />
          <RoutePlanningLinks
            currentView="fare"
            includeCustomFare={false}
            mate={mate}
            selectedDate={date.toISODate() ?? undefined}
            terminal={terminal}
          />
          <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
          <RetryButton onClick={retryCatalog} />
        </FarePageState>
      </>
    );
  }
  // label both supported journey amounts instead of presenting a round trip as one crossing
  const customRates =
    quoteResponse &&
    (quoteResponse.state === "current" || quoteResponse.state === "stale")
      ? getQuotedFareRates(quoteResponse.quote, quoteResponse.state)
      : undefined;
  const canEstimate = selection?.ok === true;
  const RestartIcon = fareWizardIcons.undo;

  return (
    <>
      {header}
      <main
        className="flex-grow overflow-y-auto bg-day-normal-light text-gray-dark motion-safe:scroll-smooth dark:bg-night-normal-dark dark:text-[#e0f0f4]"
        ref={usefulContentRef}
      >
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 pb-8">
          {catalog ? (
            <FareRatesOverview
              response={{
                state: "current",
                catalog,
                defaultRates:
                  catalogResponse?.state === "current"
                    ? catalogResponse.defaultRates
                    : undefined,
              }}
              departingName={terminal.name}
              arrivingName={mate.name}
              mate={mate}
              terminal={terminal}
            />
          ) : (
            <FareRatesOverview
              arrivingName={mate.name}
              departingName={terminal.name}
              loadingTripDate={date.toISODate() ?? ""}
              mate={mate}
              terminal={terminal}
            />
          )}
          {fareAd}
          <div
            id="custom-fare-calculator"
            className={clsx("space-y-4", CUSTOM_FARE_SECTION_CLASS)}
          >
            <section aria-label="Fare estimator">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold">Calculate a custom fare</h2>
                {config.travelMode && (
                  <button
                    className="button button-secondary button-small"
                    onClick={restart}
                    type="button"
                  >
                    <RestartIcon />
                    Restart
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm">
                Choose passengers, vehicle size and eligible discounts. Ferry
                FYI uses official WSDOT fares and does not determine
                eligibility.
              </p>
              <div className="mt-5 space-y-2">
                {wizardStep > 0 && config.travelMode && (
                  <Answer
                    {...getTravelModeAnswer(config.travelMode)}
                    onClick={() => setWizardStep(0)}
                    question="How are you traveling?"
                  />
                )}
                {wizardStep > 1 && config.travelMode === "vehicle" && (
                  <Answer
                    answer={config.isSeniorOrDisabledDriver ? "Yes" : "No"}
                    Icon={
                      config.isSeniorOrDisabledDriver
                        ? fareWizardIcons.wheelchair
                        : fareWizardIcons.user
                    }
                    onClick={() => setWizardStep(1)}
                    question="Driver is senior or has a disability"
                  />
                )}
                {wizardStep > 2 &&
                  config.travelMode === "vehicle" &&
                  config.vehicleType && (
                    <Answer
                      {...getVehicleTypeAnswer(config.vehicleType)}
                      onClick={() => setWizardStep(2)}
                      question="Vehicle type"
                    />
                  )}
                {wizardStep > 3 &&
                  config.vehicleType === "tall-or-long" &&
                  config.vehicleLength && (
                    <Answer
                      answer={`${config.vehicleLength} feet`}
                      Icon={fareWizardIcons.ruler}
                      onClick={() => setWizardStep(3)}
                      question="Vehicle length"
                    />
                  )}
              </div>
              {wizardStep === 0 && (
                <fieldset className="mt-5">
                  <legend className="text-lg font-bold">
                    How are you traveling?
                  </legend>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    {(
                      [
                        ["vehicle", "Vehicle", fareWizardIcons.car],
                        ["bicycle", "Bicycle", fareWizardIcons.bicycle],
                        ["walk-on", "Walk on", fareWizardIcons.walking],
                      ] as Array<[FareTravelMode, string, FareWizardIcon]>
                    ).map(([value, label, Icon]) => (
                      <Option
                        active={config.travelMode === value}
                        Icon={Icon}
                        key={value}
                        onClick={() => {
                          updateConfig("travelMode", value);
                          setWizardStep(value === "vehicle" ? 1 : 4);
                        }}
                      >
                        {label}
                      </Option>
                    ))}
                  </div>
                </fieldset>
              )}
              {wizardStep === 1 && config.travelMode === "vehicle" && (
                <fieldset className="mt-5">
                  <legend className="text-lg font-bold">
                    Is the driver a senior or a person with a disability?
                  </legend>
                  <p className="mt-1 text-sm opacity-75">
                    Choose Yes only for a driver age 65 or older, or one who
                    qualifies for WSF reduced fare disability eligibility.{" "}
                    <a
                      className="link text-green-dark dark:text-green-light"
                      href={WSDOT_REDUCED_FARE_URL}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Read WSF eligibility details
                    </a>
                    .
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Option
                      active={config.isSeniorOrDisabledDriver === false}
                      Icon={fareWizardIcons.user}
                      onClick={() => {
                        updateConfig("isSeniorOrDisabledDriver", false);
                        setWizardStep(2);
                      }}
                    >
                      No
                    </Option>
                    <Option
                      active={config.isSeniorOrDisabledDriver === true}
                      Icon={fareWizardIcons.wheelchair}
                      onClick={() => {
                        updateConfig("isSeniorOrDisabledDriver", true);
                        setWizardStep(2);
                      }}
                    >
                      Yes
                    </Option>
                  </div>
                </fieldset>
              )}
              {wizardStep === 2 && config.travelMode === "vehicle" && (
                <fieldset className="mt-5">
                  <legend className="text-lg font-bold">
                    What type of vehicle?
                  </legend>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {(
                      [
                        ["standard", "Standard", fareWizardIcons.car],
                        [
                          "motorcycle",
                          "Motorcycle",
                          fareWizardIcons.motorcycle,
                        ],
                        ["tall-or-long", "Tall or long", fareWizardIcons.truck],
                        ["short", "Short", fareWizardIcons.carSide],
                      ] as Array<[FareVehicleType, string, FareWizardIcon]>
                    ).map(([value, label, Icon]) => (
                      <Option
                        active={config.vehicleType === value}
                        description={getVehicleTypeDescription(value)}
                        Icon={Icon}
                        key={value}
                        onClick={() => {
                          setConfiguration({
                            ...config,
                            vehicleLength:
                              value === "tall-or-long"
                                ? (config.vehicleLength ?? 29)
                                : undefined,
                            vehicleType: value,
                          });
                          setWizardStep(value === "tall-or-long" ? 3 : 4);
                        }}
                      >
                        {label}
                      </Option>
                    ))}
                  </div>
                </fieldset>
              )}
              {wizardStep === 3 && config.travelMode === "vehicle" && (
                <fieldset className="mt-5">
                  <legend className="text-lg font-bold">Vehicle length</legend>
                  <p className="mt-1 text-sm opacity-75">
                    Enter the full length in feet. Vehicles under 30 feet in
                    this category use WSDOT's tall-vehicle fare.
                  </p>
                  <Counter
                    label="Feet"
                    min={1}
                    onChange={(value) => updateConfig("vehicleLength", value)}
                    value={config.vehicleLength ?? 29}
                  />
                  <button
                    className="button mt-3 w-full"
                    onClick={() => {
                      if (config.vehicleLength === undefined) {
                        updateConfig("vehicleLength", 29);
                      }
                      setWizardStep(4);
                    }}
                    type="button"
                  >
                    Continue
                  </button>
                </fieldset>
              )}
              {wizardStep === 4 && config.travelMode === "vehicle" && (
                <fieldset className="mt-5">
                  <legend className="text-lg font-bold">
                    Additional passengers
                  </legend>
                  <p className="mt-1 text-sm opacity-75">
                    The driver is included with the vehicle fare.
                  </p>
                  <Counter
                    description="Ages 19–64"
                    label="Adults"
                    onChange={(value) => updateConfig("adultPassengers", value)}
                    value={config.adultPassengers}
                  />
                  <Counter
                    description="Ages 18 and under"
                    label="Children"
                    onChange={(value) => updateConfig("childPassengers", value)}
                    value={config.childPassengers}
                  />
                  <Counter
                    description={
                      <>
                        Age 65+ or qualifying disability fare rider.{" "}
                        <a
                          className="link text-green-dark dark:text-green-light"
                          href={WSDOT_REDUCED_FARE_URL}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Eligibility details
                        </a>
                        .
                      </>
                    }
                    label="Seniors"
                    onChange={(value) =>
                      updateConfig("seniorPassengers", value)
                    }
                    value={config.seniorPassengers}
                  />
                </fieldset>
              )}
            </section>
            {catalog ? (
              <FareCatalogDisclosure
                response={{ state: "current", catalog }}
                departingName={terminal.name}
                arrivingName={mate.name}
              />
            ) : null}
            {catalogError ? (
              <p role="status">
                The live refresh failed; the previously fetched fare catalog is
                retained. Verify prices with WSDOT.
              </p>
            ) : null}
            {canEstimate && (
              <section aria-label="Fare estimate">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-bold">Fare estimate</h2>
                  <button
                    className="button button-secondary button-small"
                    onClick={share}
                    type="button"
                  >
                    <ShareIcon />
                    {isShareCopied ? "Copied" : "Share"}
                  </button>
                </div>
                {isQuoting && (
                  <FarePriceComparison
                    loading
                    loadingLabel="Calculating custom fare"
                  />
                )}
                {quoteResponse?.state === "unavailable" && (
                  <div className="mt-3">
                    <p>Fare unavailable.</p>
                    <CalculatorLink href={quoteResponse.calculatorUrl} />
                    <RetryButton onClick={retryQuote} />
                  </div>
                )}
                {quoteError && (
                  <div className="mt-3">
                    <p>Fare unavailable.</p>
                    <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
                    <RetryButton onClick={retryQuote} />
                  </div>
                )}
                {quoteResponse?.state === "no-fare" && (
                  <p className="mt-3">{quoteResponse.noFare.message}</p>
                )}
                {customRates && (
                  <FarePriceComparison comparison={customRates} />
                )}
                {!quoteError && quoteResponse?.state !== "unavailable" && (
                  <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
                )}
              </section>
            )}
          </div>
        </div>
      </main>
    </>
  );
};
