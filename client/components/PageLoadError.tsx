import React, { ReactElement } from "react";

interface Props {
  error?: Error | null;
  message?: string;
  onReload: () => void;
  title?: string;
}

// developer contact link
const getDeveloperContactHref = (error?: Error | null): string => {
  const details = [
    "A page failed to load in Ferry FYI.",
    `URL: ${window.location.href}`,
    error?.message ? `Error: ${error.message}` : null,
  ].filter(Boolean);
  return `mailto:dev@ferry.fyi?subject=${encodeURIComponent(
    "Ferry FYI load error"
  )}&body=${encodeURIComponent(details.join("\n"))}`;
};

// unrecoverable page load error
export const PageLoadError = ({
  error,
  message = "Ferry FYI could not load this page. Reload and try again, or contact the developer if it keeps happening.",
  onReload,
  title = "This page could not load",
}: Props): ReactElement => (
  <div
    className={[
      "absolute inset-0",
      "bg-day-normal-light text-gray-dark dark:bg-night-normal-dark dark:text-[#e0f0f4]",
      "flex items-center justify-center px-6 text-center",
    ].join(" ")}
    role="alert"
  >
    <section
      className={[
        "max-w-md rounded-2xl border p-5 shadow-sm",
        "border-gray-medium bg-white text-gray-darkest",
        "dark:border-gray-dark dark:bg-gray-darkest dark:text-white",
      ].join(" ")}
    >
      <p className="text-2xs font-bold uppercase tracking-wide text-red-dark dark:text-red-light">
        Load failed
      </p>
      <h1 className="mt-2 text-2xl font-black leading-tight">{title}</h1>
      <p className="mt-3 text-sm font-semibold leading-snug text-gray-dark dark:text-gray-light">
        {message}
      </p>
      {/* error detail guard */}
      {error?.message && (
        <p className="mt-3 rounded-lg bg-gray-lightest p-3 text-left text-xs font-semibold text-gray-dark dark:bg-black/30 dark:text-gray-light">
          {error.message}
        </p>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          className="button button-primary"
          onClick={onReload}
          type="button"
        >
          Reload
        </button>
        <a
          className="button dark:border-white dark:text-white"
          href={getDeveloperContactHref(error)}
          rel="noopener noreferrer"
          target="_blank"
        >
          Contact developer
        </a>
      </div>
    </section>
  </div>
);
