import React, { type ReactElement, type ReactNode } from "react";
import type {
  FareCurrentCatalogResponse,
  FareNoFareResponse,
} from "shared/contracts/fares";

import ChevronDownIcon from "~/static/images/icons/solid/chevron-down.svg";

const currency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

const fareEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  colon: ":",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  newline: "\n",
  quot: '"',
  tab: "\t",
};

// decode link text and URLs consistently without browser globals
const decodeFareEntities = (value: string): string =>
  value.replace(
    /&#(x[\da-f]+|\d+);|&(amp|apos|colon|gt|lt|nbsp|newline|quot|tab);/gi,
    (
      reference: string,
      numeric: string | undefined,
      named: string | undefined
    ) => {
      // decode numeric character references
      if (numeric) {
        const codePoint = numeric.toLowerCase().startsWith("x")
          ? Number.parseInt(numeric.slice(1), 16)
          : Number.parseInt(numeric);
        // replace invalid Unicode references
        if (
          codePoint <= 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return "\ufffd";
        }
        return String.fromCodePoint(codePoint);
      }
      return named
        ? (fareEntities[named.toLowerCase()] ?? reference)
        : reference;
    }
  );

// keep unsupported markup as inert readable text
const fareLabelText = (value: string): string =>
  decodeFareEntities(value.replace(/<\/?[a-z][^>]*>/gi, ""));

// accept only web links from the provider's href attribute
const fareLabelHref = (attributes: string): string | undefined => {
  // tokenize quoted attributes without inspecting their contents as attributes
  for (const attribute of attributes.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  )) {
    // ignore every attribute except the actual href
    if (attribute[1].toLowerCase() !== "href") {
      continue;
    }
    const href = decodeFareEntities(
      attribute[2] ?? attribute[3] ?? attribute[4] ?? ""
    ).trim();
    // reject empty link destinations
    if (!href) {
      return undefined;
    }
    try {
      const url = new URL(href, "https://wsdot.wa.gov/");
      // exclude executable schemes and deceptive credentials
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password
      ) {
        return url.href;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  return undefined;
};

// reconstruct only anchors rather than inserting provider HTML
const renderFareLabel = (label: string): ReactNode[] => {
  const content: ReactNode[] = [];
  let offset = 0;
  // preserve text surrounding each supported anchor
  for (const anchor of label.matchAll(
    /<a\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi
  )) {
    content.push(fareLabelText(label.slice(offset, anchor.index)));
    const href = fareLabelHref(anchor[1]);
    const text = fareLabelText(anchor[2]);
    content.push(
      href ? (
        <a
          className="link"
          href={href}
          key={anchor.index}
          rel="noopener noreferrer"
          target="_blank"
        >
          {text}
        </a>
      ) : (
        text
      )
    );
    offset = anchor.index + anchor[0].length;
  }
  content.push(fareLabelText(label.slice(offset)));
  return content;
};

// expose the provider catalog without calculating a quote
export const FareCatalogDisclosure = ({
  response,
  departingName,
  arrivingName,
}: {
  response: FareCurrentCatalogResponse | FareNoFareResponse;
  departingName?: string;
  arrivingName?: string;
}): ReactElement => {
  // preserve directions that collect no fare
  if (response.state === "no-fare") {
    return (
      <p>
        {response.noFare.message ?? "No fare is collected in this direction."}
      </p>
    );
  }
  const { fares, request } = response.catalog;
  return (
    <details className="group max-w-full" data-public-fare-catalog>
      <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1 py-2 text-center text-xs font-medium text-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 dark:text-green-light [&::-webkit-details-marker]:hidden">
        <span className="underline">Show full fare table</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="h-3 w-3 group-open:rotate-180"
          focusable="false"
        />
      </summary>
      <div className="mt-4 space-y-3 text-sm">
        <p>
          {departingName ?? request.departingTerminalId} to{" "}
          {arrivingName ?? request.arrivingTerminalId} ·{" "}
          <time dateTime={request.tripDate}>{request.tripDate}</time> ·{" "}
          {request.roundTrip ? "round-trip" : "one-way"} catalog.
        </p>
        <div className="max-w-full">
          <table className="w-full max-w-full table-fixed text-left">
            <caption className="pb-2 text-left font-bold">
              Full official fare table
            </caption>
            <thead>
              <tr>
                <th className="p-2" scope="col">
                  Fare
                </th>
                <th className="w-24 p-2 text-right" scope="col">
                  Price (USD)
                </th>
              </tr>
            </thead>
            <tbody>
              {/* preserve provider row order */}
              {fares.map((fare) => (
                <tr
                  className="border-t border-black/10 dark:border-white/10"
                  data-fare-id={fare.id}
                  key={fare.id}
                >
                  <th className="break-words p-2 font-medium" scope="row">
                    {renderFareLabel(fare.label)}
                  </th>
                  <td className="whitespace-nowrap p-2 text-right tabular-nums">
                    {currency.format(fare.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
};
