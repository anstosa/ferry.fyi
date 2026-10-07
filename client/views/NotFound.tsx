import React, { type ReactElement } from "react";
import { getNotFoundSeoMetadata } from "shared/lib/seo";

import { SeoHelmet } from "~/components/SeoHelmet";
import ArrowRightIcon from "~/static/images/icons/solid/arrow-right.svg";
import LifeRingIcon from "~/static/images/icons/solid/life-ring.svg";
import ShipIcon from "~/static/images/icons/solid/ship.svg";

const notFoundSeo = getNotFoundSeoMetadata();

/** request-neutral recovery page for unknown public paths */
export const NotFound = (): ReactElement => (
  <>
    <SeoHelmet seo={notFoundSeo} />
    <main
      aria-labelledby="not-found-title"
      className="relative min-h-screen min-h-[100dvh] overflow-hidden overflow-y-auto bg-ferry-gradient text-white scrolling-touch"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-[#4fd1b5]/20 blur-3xl"
      />

      <div className="relative z-10 mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-2xl flex-col items-center justify-center px-4 pb-[calc(2rem+var(--safe-area-inset-bottom))] pt-[calc(2rem+var(--safe-area-inset-top))] sm:px-6">
        <a
          aria-label="Ferry FYI home"
          className="flex items-center gap-3 rounded-full px-4 py-2 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          href="/"
        >
          <ShipIcon aria-hidden="true" className="h-7 w-7" />
          <span className="text-xl font-black tracking-tight">Ferry FYI</span>
        </a>

        <section
          aria-labelledby="not-found-title"
          className="mt-6 w-full rounded-[2rem] border border-white/30 bg-white/95 p-6 text-center text-gray-darkest shadow-2xl backdrop-blur-xl sm:p-10 dark:bg-blue-darkest/95 dark:text-white"
        >
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-lightest text-green-dark shadow-inner dark:bg-green-dark/40 dark:text-green-light">
            <LifeRingIcon aria-hidden="true" className="h-11 w-11" />
          </div>
          <p className="mt-5 text-sm font-black uppercase tracking-widest text-green-dark dark:text-green-light">
            404 · Off course
          </p>
          <h1
            className="mt-2 text-3xl font-black leading-tight sm:text-4xl"
            id="not-found-title"
          >
            Page not found
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-sm font-semibold leading-relaxed text-gray-dark sm:text-base dark:text-gray-light">
            Looks like this page missed the boat. Head back to the terminal
            directory to find current schedules, alerts, fares, and cameras.
          </p>

          <a
            className="button button-primary mx-auto mt-7 h-14 w-full max-w-sm text-base shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-dark dark:focus-visible:outline-green-light"
            href="/"
          >
            <ShipIcon aria-hidden="true" className="h-5 w-5" />
            <span className="button-label">Find a ferry schedule</span>
            <ArrowRightIcon aria-hidden="true" className="h-4 w-4" />
          </a>

          <div className="mt-8 border-t border-gray-light pt-6 dark:border-white/10">
            <h2 className="text-sm font-black uppercase tracking-wide text-gray-dark dark:text-gray-light">
              Popular ferry routes
            </h2>
            <nav
              aria-label="Popular ferry routes"
              className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm font-bold text-green-dark dark:text-green-light"
            >
              <a
                className="link focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-dark dark:focus-visible:outline-green-light"
                href="/seattle/bainbridge"
              >
                Seattle–Bainbridge
              </a>
              <a
                className="link focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-dark dark:focus-visible:outline-green-light"
                href="/edmonds"
              >
                Edmonds–Kingston
              </a>
              <a
                className="link focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-dark dark:focus-visible:outline-green-light"
                href="/mukilteo"
              >
                Mukilteo–Clinton
              </a>
            </nav>
            <p className="mt-6 text-sm text-gray-dark dark:text-gray-light">
              Still adrift?{" "}
              <a
                className="font-bold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-dark dark:focus-visible:outline-green-light"
                href="/support"
              >
                Contact Ferry FYI support
              </a>
              .
            </p>
          </div>
        </section>
      </div>
    </main>
  </>
);
