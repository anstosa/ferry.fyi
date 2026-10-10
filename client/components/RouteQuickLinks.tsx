import clsx from "clsx";
import React, { type ReactElement } from "react";
import { Link } from "react-router-dom";

interface QuickLink {
  Icon: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  label: string;
  path: string;
  inPage?: boolean;
  solid?: boolean;
}

const LINK_CLASS =
  "inline-flex w-fit min-h-9 shrink-0 items-center justify-start gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1.5 text-left text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

// share natural-width planning buttons across route pages
export const RouteQuickLinks = ({
  ariaLabel = "Route quick links",
  links,
}: {
  ariaLabel?: string;
  links: readonly QuickLink[];
}): ReactElement => (
  <nav
    aria-label={ariaLabel}
    className="mt-2 flex flex-wrap items-start justify-start gap-1.5"
  >
    {links.map(({ Icon, inPage, label, path, solid }) => {
      // distinguish the primary action without changing compact button geometry
      const className = clsx(
        LINK_CLASS,
        solid
          ? "border-green-dark bg-green-dark text-white hover:opacity-90"
          : "border-green-dark/20 text-green-dark hover:bg-green-dark/5 dark:border-green-light/30 dark:text-[#b5ead9] dark:hover:bg-white/5"
      );
      const content = (
        <>
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          {label}
        </>
      );
      // native fragments preserve smooth scrolling within the existing page
      if (inPage) {
        return (
          <a className={className} href={path} key={label}>
            {content}
          </a>
        );
      }
      return (
        <Link className={className} key={label} to={path}>
          {content}
        </Link>
      );
    })}
  </nav>
);
