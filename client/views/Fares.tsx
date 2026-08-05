import clsx from "clsx";
import { DateTime } from "luxon";
import React, {
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import type {
  FareCatalogApiResponse,
  FareQuoteApiResponse,
  FareQuoteRequest,
  FareTotal,
} from "shared/contracts/fares";
import type { Terminal } from "shared/contracts/terminals";

import { AdSlot } from "~/components/AdSlot";
import { DateButton } from "~/components/DateButton";
import { ExternalPillLink } from "~/components/ExternalPillLink";
import { FareWizardIcon, fareWizardIcons } from "~/components/FareWizardIcons";
import { RouteSelector } from "~/components/RouteSelector";
import { Skeleton, SkeletonGroup } from "~/components/Skeleton";
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

const currency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

const WSDOT_FARE_CALCULATOR_URL = "https://wsdot.wa.gov/ferries/fares/";
const WSDOT_REDUCED_FARE_URL =
  "https://wsdot.wa.gov/ferries/rider-information/ada#Reduced%20fare%20passenger%20tickets";

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

const StateCard = ({
  children,
}: {
  children: React.ReactNode;
}): ReactElement => (
  <main className="flex-grow overflow-y-auto bg-day-normal-light p-4 text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
    <div className="mx-auto w-full max-w-6xl rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-blue-dark">
      {children}
    </div>
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

export const Fares = ({
  date,
  mate,
  setDate,
  setRoute,
  terminal,
}: Props): ReactElement => {
  const seededCatalog = usePublicSsrSource("fares");
  const { search } = useLocation();
  const [catalogResponse, setCatalogResponse] =
    useState<FareCatalogApiResponse | null>(() => seededCatalog ?? null);
  const [catalogError, setCatalogError] = useState<Error | null>(null);
  const [isLoadingCatalog, setLoadingCatalog] = useState(!seededCatalog);
  const [isQuoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<Error | null>(null);
  const [quoteResponse, setQuoteResponse] =
    useState<FareQuoteApiResponse | null>(null);
  const [config, setConfig] = useState<FareWizardConfig>(() =>
    parseFareWizardConfig(search)
  );
  const [isShareCopied, setShareCopied] = useState(false);
  const [wizardStep, setWizardStep] = useState(() =>
    getWizardStep(parseFareWizardConfig(search))
  );
  const catalogRequestRef = useRef(0);
  const catalogScopeRef = useRef<string | null>(null);
  const catalogRetryRef = useRef({ attempts: 0, scope: "" });
  const quoteRequestRef = useRef(0);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [quoteRetry, setQuoteRetry] = useState(0);

  useEffect(() => {
    const scope = `${terminal.id}:${mate.id}:${date.toISODate() ?? ""}`;
    const isInitialSeedScope = catalogScopeRef.current === null;
    catalogScopeRef.current = scope;
    if (catalogRetryRef.current.scope !== scope) {
      catalogRetryRef.current = { attempts: 0, scope };
    }
    const requestId = catalogRequestRef.current + 1;
    catalogRequestRef.current = requestId;
    if (!isInitialSeedScope) {
      setLoadingCatalog(true);
    }
    setCatalogError(null);
    // Keep the server-provided catalog visible during the first post-commit
    // refresh. A failed refresh must not replace a usable anonymous seed.
    if (!isInitialSeedScope) {
      setCatalogResponse(null);
    }
    getFareCatalog(terminal, mate, date)
      .then(
        (response) =>
          requestId === catalogRequestRef.current &&
          setCatalogResponse(response)
      )
      .catch(
        (error: unknown) =>
          requestId === catalogRequestRef.current &&
          setCatalogError(
            error instanceof Error ? error : new Error(String(error))
          )
      )
      .finally(
        () =>
          requestId === catalogRequestRef.current && setLoadingCatalog(false)
      );
  }, [catalogRetry, date, mate, terminal]);

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
      setConfig(next);
      setWizardStep(getWizardStep(next));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const setConfiguration = (next: FareWizardConfig): void => {
    const search = withFareWizardConfig(window.location.search, next);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${search}${window.location.hash}`
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
    setQuoteRetry((current) => current + 1);
  };
  const catalog =
    catalogResponse?.state === "current" ? catalogResponse.catalog : null;
  const selection = useMemo(
    () => catalog && createFareWizardSelections(catalog.fares, config),
    [catalog, config]
  );

  const catalogLabels = catalog?.fares.map((fare) => fare.label).join(", ");

  useEffect(() => {
    quoteRequestRef.current += 1;
    const requestId = quoteRequestRef.current;
    setQuoteResponse(null);
    setQuoteError(null);
    if (!selection?.ok) {
      setQuoting(false);
      return;
    }
    setQuoting(true);
    getFareQuote({
      arrivingTerminalId: mate.id,
      departingTerminalId: terminal.id,
      lineItems: selection.lineItems,
      roundTrip: false,
      tripDate: date.toISODate() as FareQuoteRequest["tripDate"],
    })
      .then(
        (response) =>
          requestId === quoteRequestRef.current && setQuoteResponse(response)
      )
      .catch(
        (error: unknown) =>
          requestId === quoteRequestRef.current &&
          setQuoteError(
            error instanceof Error
              ? error
              : new Error("Fare quote could not load.")
          )
      )
      .finally(
        () => requestId === quoteRequestRef.current && setQuoting(false)
      );
  }, [date, mate.id, quoteRetry, selection, terminal.id]);

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
        return;
      }
      await navigator.clipboard?.writeText(window.location.href);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2500);
    } catch (error) {
      console.error("Failed to share fare configuration", error);
    }
  };

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
  if (isLoadingCatalog) {
    return (
      <>
        {header}
        <StateCard>
          <SkeletonGroup label="Loading fare estimator" className="space-y-5">
            <div>
              <Skeleton className="h-7 w-40" variant="text" />
              <Skeleton className="mt-3 h-4 w-full max-w-2xl" variant="text" />
            </div>
            <div>
              <Skeleton className="h-6 w-52" variant="text" />
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            </div>
          </SkeletonGroup>
        </StateCard>
      </>
    );
  }
  if (catalogError && !catalogResponse) {
    return (
      <>
        {header}
        <StateCard>
          <h1 className="text-xl font-bold">Fares unavailable</h1>
          <p className="mt-2">Fare information could not load right now.</p>
          <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
          <RetryButton onClick={retryCatalog} />
        </StateCard>
      </>
    );
  }
  if (catalogResponse?.state === "unavailable") {
    return (
      <>
        {header}
        <StateCard>
          <h1 className="text-xl font-bold">Fares unavailable</h1>
          <p className="mt-2">
            Current fare information is not available for this route and date.
          </p>
          <CalculatorLink href={catalogResponse.calculatorUrl} />
          <RetryButton onClick={retryCatalog} />
        </StateCard>
      </>
    );
  }
  if (catalogResponse?.state === "no-fare") {
    return (
      <>
        {header}
        <StateCard>
          <h1 className="text-xl font-bold">FREE</h1>
          <p className="mt-2">{catalogResponse.noFare.message}</p>
          <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
        </StateCard>
      </>
    );
  }
  if (!catalog) {
    return (
      <>
        {header}
        <StateCard>
          <h1 className="text-xl font-bold">Fares unavailable</h1>
          <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
          <RetryButton onClick={retryCatalog} />
        </StateCard>
      </>
    );
  }
  const total =
    quoteResponse &&
    (quoteResponse.state === "current" || quoteResponse.state === "stale")
      ? getTotal(quoteResponse.quote.totals)
      : undefined;
  const canEstimate = selection?.ok === true;
  const RestartIcon = fareWizardIcons.undo;

  return (
    <>
      {header}
      <main className="flex-grow overflow-y-auto bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        {catalogLabels ? (
          <p className="sr-only" data-testid="fare-catalog-labels">
            Available fare catalog: {catalogLabels}
          </p>
        ) : null}
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 pb-8">
          <AdSlot
            arrivalTerminalId={mate.id}
            contextLabel={`Fares · ${terminal.name} to ${mate.name}`}
            departureTerminalId={terminal.id}
            slot="fare"
          />
          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-blue-dark">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-xl font-bold">Fare estimator</h1>
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
              Choose trip details for one crossing. Ferry FYI uses official
              WSDOT fares and does not determine eligibility.
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
                      ["motorcycle", "Motorcycle", fareWizardIcons.motorcycle],
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
                  Enter the full length in feet. Vehicles under 30 feet in this
                  category use WSDOT's tall-vehicle fare.
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
                  onChange={(value) => updateConfig("seniorPassengers", value)}
                  value={config.seniorPassengers}
                />
              </fieldset>
            )}
          </section>
          {canEstimate && (
            <section className="rounded-2xl bg-white p-5 dark:bg-blue-dark">
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
              {isQuoting && <p className="mt-3">Calculating official fare…</p>}
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
              {total && (
                <>
                  <p className="mt-3 text-3xl font-bold">
                    {currency.format(total.amount)}
                  </p>
                  <p className="mt-2 text-sm">
                    {quoteResponse?.state === "stale"
                      ? "This is a stale official quote."
                      : "Current official WSDOT quote."}
                  </p>
                </>
              )}
              {!quoteError && quoteResponse?.state !== "unavailable" && (
                <CalculatorLink href={WSDOT_FARE_CALCULATOR_URL} />
              )}
            </section>
          )}
        </div>
      </main>
    </>
  );
};
