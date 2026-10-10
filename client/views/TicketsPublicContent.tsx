import React, { type ReactElement, type ReactNode } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import ExternalLinkIcon from "~/static/images/icons/solid/external-link.svg";

const WSF_RESERVATION_URL =
  "https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/default.aspx?op=Make+reservations";
const WSF_TICKETS_URL =
  "https://wave2go.wsdot.com/webstore/landingPage?cg=21&c=76";
const PURCHASE_LINK_CLASSES =
  "button button-secondary h-auto min-h-12 w-full justify-between overflow-visible whitespace-normal px-4 py-3 text-left";

interface TicketsPublicContentProps {
  showEmptyState?: boolean;
  showPurchaseLinks?: boolean;
  tools?: ReactNode;
}

// render unboxed wallet tools without personal ticket state
export const TicketsPublicContent = ({
  showEmptyState = false,
  showPurchaseLinks = true,
  tools,
}: TicketsPublicContentProps): ReactElement => (
  <>
    <section className="mt-4 space-y-5">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-green-dark dark:text-green-light">
          Wallet
        </p>
        <h2 className="mt-2 text-3xl font-black tracking-tight">
          Ferry tickets, ready to scan
        </h2>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-relaxed text-gray-600 dark:text-gray-300">
          Keep Washington State Ferries tickets handy by scanning a barcode or
          QR code, uploading a clear ticket image, or entering its code
          manually.
        </p>
      </div>

      {/* enhance wallet tools in the browser */}
      {tools ?? (
        <ul className="grid gap-2 text-sm font-semibold sm:grid-cols-3">
          <li className="rounded-xl bg-white p-3 dark:bg-white/5">
            Scan a ticket code
          </li>
          <li className="rounded-xl bg-white p-3 dark:bg-white/5">
            Upload a ticket image
          </li>
          <li className="rounded-xl bg-white p-3 dark:bg-white/5">
            Enter a code manually
          </li>
        </ul>
      )}

      {/* preserve focused wallet entry */}
      {showPurchaseLinks ? (
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-green-dark dark:text-green-light">
            Purchase tickets
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <a
              className={PURCHASE_LINK_CLASSES}
              href={WSF_RESERVATION_URL}
              rel="noreferrer"
              target="_blank"
            >
              <span>Make a reservation</span>
              <ExternalLinkIcon
                aria-hidden="true"
                className="button-icon shrink-0"
              />
            </a>
            <a
              className={PURCHASE_LINK_CLASSES}
              href={WSF_TICKETS_URL}
              rel="noreferrer"
              target="_blank"
            >
              <span>Buy Tickets</span>
              <ExternalLinkIcon
                aria-hidden="true"
                className="button-icon shrink-0"
              />
            </a>
          </div>
        </div>
      ) : null}
    </section>

    {/* retain a standalone public empty state without the removed guidance */}
    {showEmptyState ? (
      <section className="mt-5 rounded-2xl border border-dashed border-[rgba(0,0,0,0.16)] p-5 text-center dark:border-[rgba(255,255,255,0.18)]">
        <h2 className="text-lg font-black">No saved tickets yet</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Use the browser or app tools to scan, upload, or manually add a ticket
          to your wallet.
        </p>
      </section>
    ) : null}
  </>
);

// render the complete universal ticket page
export const TicketsPublicPage = (): ReactElement => (
  <Page publicTitle="Tickets">
    <SeoHelmet seo={getSeoMetadata("/tickets")} />
    <TicketsPublicContent showEmptyState />
  </Page>
);
