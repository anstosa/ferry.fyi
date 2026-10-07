import React, { type ReactElement, type ReactNode } from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import ExternalLinkIcon from "~/static/images/icons/solid/external-link.svg";

const WSF_RESERVATION_URL =
  "https://secureapps.wsdot.wa.gov/ferries/reservations/vehicle/default.aspx?op=Make+reservations";
const WSF_MULTI_RIDE_URL =
  "https://wave2go.wsdot.com/webstore/landingPage?cg=21&c=76";
const PURCHASE_LINK_CLASSES =
  "button button-glass h-auto min-h-12 w-full justify-between overflow-visible whitespace-normal px-4 py-3 text-left";

interface TicketsPublicContentProps {
  showEmptyState?: boolean;
  showPurchaseLinks?: boolean;
  tools?: ReactNode;
}

// render public wallet guidance without ticket state
export const TicketsPublicContent = ({
  showEmptyState = false,
  showPurchaseLinks = true,
  tools,
}: TicketsPublicContentProps): ReactElement => (
  <>
    <section className="mt-4 overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.08)] bg-[linear-gradient(135deg,#016f52_0%,#004d61_100%)] text-white shadow-lg dark:border-[rgba(255,255,255,0.08)]">
      <div className="relative p-5 sm:p-6">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 right-12 h-36 w-36 rounded-full bg-yellow-medium/20 blur-sm" />
        <div className="relative flex flex-col gap-5">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-yellow-lightest">
              Wallet
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              Ferry tickets, ready to scan
            </h2>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-relaxed text-white/85">
              Keep Washington State Ferries tickets handy by scanning a barcode
              or QR code, uploading a clear ticket image, or entering its code
              manually.
            </p>
          </div>

          {/* enhance wallet tools in the browser */}
          {tools ?? (
            <ul className="grid gap-2 text-sm font-semibold sm:grid-cols-3">
              <li className="rounded-xl bg-white/15 p-3">Scan a ticket code</li>
              <li className="rounded-xl bg-white/15 p-3">
                Upload a ticket image
              </li>
              <li className="rounded-xl bg-white/15 p-3">
                Enter a code manually
              </li>
            </ul>
          )}

          {/* preserve focused wallet entry */}
          {showPurchaseLinks ? (
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-yellow-lightest">
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
                  <ExternalLinkIcon className="button-icon shrink-0" />
                </a>
                <a
                  className={PURCHASE_LINK_CLASSES}
                  href={WSF_MULTI_RIDE_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span>Buy multi-ride passes</span>
                  <ExternalLinkIcon className="button-icon shrink-0" />
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>

    <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm dark:bg-[#00202a]">
      <h2 className="text-xl font-black text-green-dark dark:text-green-light">
        Using your ticket wallet
      </h2>
      <p className="mt-2 text-sm leading-relaxed">
        Open a saved ticket before boarding so its barcode or QR code is ready
        for the WSF scanner. Treat ticket images and codes like the original
        ticket: do not post or share them publicly.
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        Reservations and multi-ride passes are purchased directly through WSF.
        Ferry FYI helps display tickets but does not sell them or guarantee that
        a ticket is valid for a particular sailing.
      </p>
      {/* explain the public empty state */}
      {showEmptyState ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[rgba(0,0,0,0.16)] p-5 text-center dark:border-[rgba(255,255,255,0.18)]">
          <h3 className="text-lg font-black">No saved tickets yet</h3>
          <p className="mt-2 text-sm">
            Use the browser or app tools to scan, upload, or manually add a
            ticket to your wallet.
          </p>
        </div>
      ) : null}
    </section>
  </>
);

// render the complete universal ticket page
export const TicketsPublicPage = (): ReactElement => (
  <Page publicTitle="Tickets">
    <SeoHelmet seo={getSeoMetadata("/tickets")} />
    <TicketsPublicContent showEmptyState />
  </Page>
);
