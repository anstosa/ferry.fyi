import React, { PropsWithChildren, ReactElement } from "react";
import { Link } from "react-router-dom";

import logo from "~/static/images/icon_monochrome-256.png?inline";

interface Props {
  description?: string;
  eyebrow?: string;
  title: string;
  titleId: string;
}

// branded authentication page shell
export const AuthPageShell = ({
  children,
  description,
  eyebrow,
  title,
  titleId,
}: PropsWithChildren<Props>): ReactElement => (
  <main className="relative min-h-screen min-h-[100dvh] overflow-hidden overflow-y-auto bg-ferry-gradient text-white scrolling-touch">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-white/10 blur-3xl"
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-[#4fd1b5]/20 blur-3xl"
    />
    <div className="relative z-10 mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-2xl flex-col items-center px-4 pb-[calc(2rem+var(--safe-area-inset-bottom))] pt-[calc(2rem+var(--safe-area-inset-top))] sm:px-6 sm:pt-[calc(3rem+var(--safe-area-inset-top))]">
      <Link
        aria-label="Ferry FYI home"
        className="flex flex-col items-center rounded-3xl px-5 py-2 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        to="/"
      >
        <img alt="" className="w-28" height={112} src={logo} width={112} />
        <span className="text-4xl font-bold tracking-tight">Ferry FYI</span>
      </Link>

      <section
        aria-labelledby={titleId}
        className="mt-7 w-full rounded-[2rem] border border-white/30 bg-white/95 p-6 text-center text-gray-darkest shadow-2xl backdrop-blur-xl sm:p-10 dark:bg-blue-darkest/95 dark:text-white"
      >
        {/* optional eyebrow */}
        {eyebrow && (
          <p className="text-xs font-black uppercase tracking-[0.2em] text-green-dark dark:text-green-light">
            {eyebrow}
          </p>
        )}
        <h1
          className={`${eyebrow ? "mt-3" : ""} text-2xl font-black leading-tight sm:text-3xl`}
          id={titleId}
        >
          {title}
        </h1>
        {/* optional description */}
        {description && (
          <p className="mx-auto mt-4 max-w-lg text-sm font-semibold leading-relaxed text-gray-dark sm:text-base dark:text-gray-light">
            {description}
          </p>
        )}
        {children}
      </section>

      <Link
        className="mt-6 rounded-full px-4 py-2 text-sm font-bold text-white/90 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        to="/"
      >
        Back to ferry schedules
      </Link>
    </div>
  </main>
);
