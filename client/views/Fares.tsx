import clsx from "clsx";
import { DateTime } from "luxon";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import type {
  FareCatalogApiResponse,
  FareLineItem,
  FareQuoteApiResponse,
  FareQuoteRequest,
  FareTotal,
} from "shared/contracts/fares";
import type { Terminal } from "shared/contracts/terminals";

import { DateButton } from "~/components/DateButton";
import { InlineLoader } from "~/components/InlineLoader";
import { getFareCatalog, getFareQuote } from "~/lib/fares";
import WSDOTIcon from "~/static/images/icons/wsdot.svg";
import { Header } from "~/views/Header";

interface Props {
  date: DateTime;
  mate: Terminal;
  setDate: (date: DateTime) => void;
  terminal: Terminal;
}

const currency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

const formatTimestamp = (timestamp: number): string =>
  DateTime.fromSeconds(timestamp).toLocaleString(DateTime.DATETIME_MED);

const getTotal = (totals: FareTotal[]): FareTotal | undefined =>
  totals.find(({ type }) => type === "total");

const currentItemQuantities = (items: FareLineItem[]): Record<number, number> =>
  items.reduce<Record<number, number>>((memo, item) => {
    memo[item.id] = 0;
    return memo;
  }, {});

const StateCard = ({
  children,
}: {
  children: React.ReactNode;
}): ReactElement => (
  <main className="flex-grow overflow-y-auto bg-day-normal-light p-4 text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
    <div className="mx-auto max-w-2xl rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-blue-dark">
      {children}
    </div>
  </main>
);

const CalculatorLink = ({ href }: { href: string }): ReactElement => (
  <a
    className="link mt-4 inline-flex items-center text-green-dark dark:text-green-light"
    href={href}
    rel="noopener noreferrer"
    target="_blank"
  >
    Open the official WSDOT fare calculator
  </a>
);

/** Neutral catalog controls: they present WSDOT line items without eligibility advice. */
export const Fares = ({
  date,
  mate,
  setDate,
  terminal,
}: Props): ReactElement => {
  const [catalogResponse, setCatalogResponse] =
    useState<FareCatalogApiResponse | null>(null);
  const [catalogError, setCatalogError] = useState<Error | null>(null);
  const [isLoadingCatalog, setLoadingCatalog] = useState(true);
  const [isQuoting, setQuoting] = useState(false);
  const [quoteResponse, setQuoteResponse] =
    useState<FareQuoteApiResponse | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const requestRef = useRef(0);
  const quoteRequestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    // A route/date catalog change makes any in-flight quote obsolete.
    quoteRequestRef.current += 1;
    setLoadingCatalog(true);
    setQuoting(false);
    setCatalogError(null);
    setCatalogResponse(null);
    setQuoteResponse(null);
    getFareCatalog(terminal, mate, date)
      .then((response) => {
        if (requestId !== requestRef.current) {
          return;
        }
        setCatalogResponse(response);
        setQuantities(
          response.state === "current"
            ? currentItemQuantities(response.catalog.fares)
            : {}
        );
      })
      .catch((error: unknown) => {
        if (requestId !== requestRef.current) {
          return;
        }
        setCatalogError(
          error instanceof Error ? error : new Error(String(error))
        );
      })
      .finally(() => {
        if (requestId === requestRef.current) {
          setLoadingCatalog(false);
        }
      });
  }, [terminal.id, mate.id, date.toISODate()]);

  const updateQuantity = (id: number, value: string): void => {
    const next = Number(value);
    setQuoteResponse(null);
    setQuantities((current) => ({
      ...current,
      [id]: Number.isInteger(next) && next > 0 ? next : 0,
    }));
  };

  const requestQuote = async (): Promise<void> => {
    if (!catalogResponse || catalogResponse.state !== "current") {
      return;
    }
    const quoteRequestId = quoteRequestRef.current + 1;
    quoteRequestRef.current = quoteRequestId;
    setQuoting(true);
    setQuoteResponse(null);
    try {
      const response = await getFareQuote({
        arrivingTerminalId: mate.id,
        departingTerminalId: terminal.id,
        lineItems: Object.entries(quantities)
          .map(([fareLineItemId, quantity]) => ({
            fareLineItemId: Number(fareLineItemId),
            quantity,
          }))
          .filter(({ quantity }) => quantity > 0),
        roundTrip: false,
        tripDate: date.toISODate() as FareQuoteRequest["tripDate"],
      });
      if (quoteRequestId !== quoteRequestRef.current) {
        return;
      }
      setQuoteResponse(response);
    } catch {
      if (quoteRequestId !== quoteRequestRef.current) {
        return;
      }
      // Keep the public UI safe if the transport itself fails.
      setQuoteResponse(null);
      setCatalogError(new Error("Fare quote could not load."));
    } finally {
      if (quoteRequestId === quoteRequestRef.current) {
        setQuoting(false);
      }
    }
  };

  const header = (
    <Header
      share={{
        shareButtonText: "Share fares",
        sharedText: `Fares for ${terminal.name} to ${mate.name}`,
      }}
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
      <div className="min-w-0 flex-1 text-center font-bold">Fares</div>
      <DateButton defaultDate={date} onDateChange={setDate} />
    </Header>
  );

  if (isLoadingCatalog) {
    return (
      <>
        {header}
        <StateCard>
          <InlineLoader />
        </StateCard>
      </>
    );
  }

  if (catalogError) {
    return (
      <>
        {header}
        <StateCard>
          <h1 className="text-xl font-bold">Fares unavailable</h1>
          <p className="mt-2">Fare information could not load right now.</p>
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
        </StateCard>
      </>
    );
  }

  if (catalogResponse?.state === "no-fare") {
    return (
      <>
        {header}
        <StateCard>
          <h1 className="text-xl font-bold">{currency.format(0)} fare</h1>
          {catalogResponse.noFare.message && (
            <p className="mt-2">{catalogResponse.noFare.message}</p>
          )}
          {catalogResponse.noFare.sourceUrl && (
            <CalculatorLink href={catalogResponse.noFare.sourceUrl} />
          )}
        </StateCard>
      </>
    );
  }

  const catalog = catalogResponse?.catalog;
  if (!catalog) {
    return (
      <>
        {header}
        <StateCard>
          <h1 className="text-xl font-bold">Fares unavailable</h1>
        </StateCard>
      </>
    );
  }
  const total =
    quoteResponse &&
    (quoteResponse.state === "current" || quoteResponse.state === "stale")
      ? getTotal(quoteResponse.quote.totals)
      : undefined;

  return (
    <>
      {header}
      <main className="flex-grow overflow-y-auto bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]">
        <div className="mx-auto max-w-2xl space-y-4 p-4 pb-8">
          <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-blue-dark">
            <h1 className="text-xl font-bold">Official WSDOT fares</h1>
            <p className="mt-1 text-sm">
              Select official line items for one crossing. Ferry FYI does not
              determine eligibility.
            </p>
            {catalog.collectionDescription && (
              <p className="mt-3 text-sm">{catalog.collectionDescription}</p>
            )}
            <div className="mt-4 divide-y divide-black/10 dark:divide-white/10">
              {catalog.fares.map((item) => (
                <label className="flex items-center gap-3 py-3" key={item.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-sm opacity-75">
                      {item.category} · {currency.format(item.amount)}
                    </span>
                  </span>
                  <input
                    aria-label={`${item.label} quantity`}
                    className="w-16 rounded border border-gray-300 bg-white p-2 text-right dark:bg-black"
                    min="0"
                    onChange={(event) =>
                      updateQuantity(item.id, event.target.value)
                    }
                    step="1"
                    type="number"
                    value={quantities[item.id] ?? 0}
                  />
                </label>
              ))}
            </div>
            <button
              className={clsx(
                "mt-5 rounded bg-green-dark px-4 py-2 font-bold text-white",
                isQuoting && "opacity-60"
              )}
              disabled={isQuoting}
              onClick={requestQuote}
              type="button"
            >
              {isQuoting ? "Calculating…" : "Calculate fare"}
            </button>
          </section>
          {quoteResponse?.state === "no-fare" && (
            <section className="rounded-2xl bg-white p-5 dark:bg-blue-dark">
              <h2 className="text-xl font-bold">{currency.format(0)} fare</h2>
              <p className="mt-2">{quoteResponse.noFare.message}</p>
            </section>
          )}
          {quoteResponse?.state === "unavailable" && (
            <section className="rounded-2xl bg-white p-5 dark:bg-blue-dark">
              <h2 className="text-xl font-bold">Fare unavailable</h2>
              <CalculatorLink href={quoteResponse.calculatorUrl} />
            </section>
          )}
          {total && (
            <section className="rounded-2xl bg-white p-5 dark:bg-blue-dark">
              <h2 className="text-xl font-bold">
                Official total: {currency.format(total.amount)}
              </h2>
              {quoteResponse?.state === "stale" && (
                <>
                  <p className="mt-2 text-sm">
                    This is a stale quote from{" "}
                    {formatTimestamp(quoteResponse.staleAt)} and is not current.
                  </p>
                  <CalculatorLink href={quoteResponse.calculatorUrl} />
                </>
              )}
              {quoteResponse?.state === "current" && (
                <p className="mt-2 text-sm">Current WSDOT quote.</p>
              )}
            </section>
          )}
        </div>
      </main>
    </>
  );
};
