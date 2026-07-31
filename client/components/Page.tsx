import clsx from "clsx";
import React, {
  FunctionComponent,
  lazy,
  PropsWithChildren,
  ReactElement,
  ReactNode,
  Suspense,
} from "react";

import { useAppRenderContext } from "../lib/renderContext";

// Header imports account and native integrations. Keep it out of the
// browser-neutral route tree while retaining the existing browser shell.
const Header = lazy(() =>
  import("../views/Header").then(({ Header }) => ({ default: Header }))
);

interface Props {
  headerAction?: ReactNode;
  title?: string;
}

// app page shell
export const Page: FunctionComponent<PropsWithChildren<Props>> = ({
  headerAction,
  title,
  children,
}): ReactElement => {
  const { runtime } = useAppRenderContext();
  const content = <main className="mx-auto w-full max-w-6xl">{children}</main>;

  return (
    <div
      className={clsx(
        "px-4 pb-10",
        "h-full min-h-full overflow-y-auto scrolling-touch",
        "bg-gray-100 text-gray-900 dark:bg-blue-darkest dark:text-gray-300"
      )}
    >
      {runtime === "server" || runtime === "hydrate" ? (
        content
      ) : (
        <Suspense fallback={null}>
          <Header>
            <h1 className="min-w-0 flex-1 truncate font-bold text-2xl">
              {title ?? "Ferry FYI"}
            </h1>
            {headerAction && (
              <div className="ml-auto shrink-0">{headerAction}</div>
            )}
          </Header>
          {content}
        </Suspense>
      )}
    </div>
  );
};
