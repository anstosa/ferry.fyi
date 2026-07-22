import React, { FunctionComponent } from "react";
import { Link } from "react-router-dom";
import type { SeoMetadata } from "shared/lib/seo";

interface Props {
  seo: SeoMetadata;
}

// Keep the visible hierarchy aligned with the structured data on indexable pages.
export const SeoBreadcrumbs: FunctionComponent<Props> = ({ seo }) => {
  if (seo.robots !== "index,follow" || seo.breadcrumbs.length < 2) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="mt-4 text-sm text-gray-600">
      <ol className="flex flex-wrap gap-x-2 gap-y-1">
        {seo.breadcrumbs.map(({ name, path }, index) => {
          const isCurrent = index === seo.breadcrumbs.length - 1;
          return (
            <li className="flex items-center gap-x-2" key={`${name}-${index}`}>
              {path && !isCurrent ? (
                <Link className="link" to={path}>
                  {name}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "page" : undefined}>
                  {name}
                </span>
              )}
              {!isCurrent && <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
