import React, { type ReactElement, type ReactNode } from "react";

// keep primary titles and their subtitle spacing identical in every render state
export const RoutePageIntro = ({
  description,
  id,
  title,
}: {
  description?: ReactNode;
  id?: string;
  title: ReactNode;
}): ReactElement => (
  <div data-route-page-intro>
    <h1
      className="text-xl font-bold leading-tight sm:text-2xl text-black dark:text-white"
      id={id}
    >
      {title}
    </h1>
    {/* supporting copy starts after the same gap without an empty spacer */}
    {description ? (
      <p className="mt-2 text-sm leading-normal text-gray-600 dark:text-gray-300">
        {description}
      </p>
    ) : null}
  </div>
);
