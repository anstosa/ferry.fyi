import { isNull } from "lodash";
import clsx from "clsx";
import React, { FunctionComponent, ReactNode, useState } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

enum Platform {
  android = "android",
  ios = "ios",
}

export const Menu: FunctionComponent<Props> = (props) => {
  const { isOpen, onClose } = props;
  const [platform, setPlatform] = useState<Platform | null>(null);

  const renderStepIcon = (className: string): ReactNode => (
    <i className={clsx(className, "mx-2 w-4 text-center")} />
  );

  const renderInstall = (): ReactNode => {
    const isInstalled = window.matchMedia("(display-mode: standalone)").matches;

    if (isInstalled) {
      return null;
    }

    return (
      <>
        <h2 className="font-medium text-lg mt-8">Install App</h2>
        <div className="mt-2">
          Want to install Ferry FYI as an app on your homescreen?
          {isNull(platform) && (
            <div className="flex mt-4">
              <button
                className={clsx("button button-invert", "flex-grow")}
                onClick={() => setPlatform(Platform.ios)}
              >
                <i className="button-icon fab fa-lg fa-apple" />
                <span className="button-label">iOS</span>
              </button>
              <button
                className={clsx("button button-invert", "flex-grow ml-4")}
                onClick={() => setPlatform(Platform.android)}
              >
                <i className="button-icon fab fa-lg fa-android" />
                <span className="button-label">Android</span>
              </button>
            </div>
          )}
          {platform === Platform.ios && (
            <ol className="my-2 list-decimal list-inside">
              <li>
                {renderStepIcon("fab fa-safari")}
                Safari
              </li>
              <li>
                {renderStepIcon("fal fa-external-link")}
                Share
              </li>
              <li>
                {renderStepIcon("fal fa-plus-square")}
                Add to Home Screen
              </li>
            </ol>
          )}
          {platform === Platform.android && (
            <ol className="my-2 list-decimal list-inside">
              <li>
                {renderStepIcon("fab fa-chrome")}
                Chrome
              </li>
              <li>
                {renderStepIcon("fas fa-ellipsis-v")}
                Menu
              </li>
              <li>
                {renderStepIcon("inline-block")}
                Add to Home Screen
              </li>
            </ol>
          )}
        </div>
      </>
    );
  };

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0",
          "animate",
          isOpen ? "z-20" : "z-bottom pointer-events-none",
          isOpen ? "bg-darken-low" : "bg-transparent"
        )}
        onClick={onClose}
      />
      <div
        className={clsx(
          "animate",
          "flex flex-col",
          "bg-green-dark text-white shadow-lg",
          "w-full h-screen max-w-xs",
          "fixed top-0 left-0 z-20",
          "pt-safe-top pb-safe-bottom pl-safe-left",
          isOpen ? "ml-0" : "-ml-96"
        )}
      >
        <div
          className={clsx("h-16 w-full p-4", "text-2xl", "flex items-center")}
        >
          <i className="fas fa-ship mr-4" />
          <h1 className="font-bold">Ferry FYI</h1>
          <div className="flex-grow" />
          <i
            className={clsx("fas fa-chevron-left text-md", "cursor-pointer")}
            onClick={onClose}
          />
        </div>
        <div
          className={clsx(
            "overflow-y-scroll scrolling-touch px-4",
            "flex-grow flex flex-col"
          )}
        >
          <p className="mt-4">
            A ferry schedule and tracker for the greater Seattle area. Supports
            all{" "}
            <a
              className="link"
              href="https://www.wsdot.wa.gov/ferries/"
              target="_blank"
              rel="noopener noreferrer"
            >
              WSF
            </a>{" "}
            routes.
          </p>
          {renderInstall()}
          <h2 className="font-medium text-lg mt-8">Feedback</h2>
          <p className="mt-2">
            See something wrong? Want to request a feature?{" "}
            <a
              className="link"
              href="https://github.com/anstosa/ferry.fyi/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              File a ticket on GitHub
            </a>{" "}
            or{" "}
            <a
              className="link"
              href="mailto:dev@ferry.fyi"
              target="_blank"
              rel="noopener noreferrer"
            >
              email dev@ferry.fyi
            </a>
            .
          </p>
          <h2 className="font-medium text-lg mt-8">Support</h2>
          <p className="mt-2">
            If Ferry FYI is useful to you please consider making{" "}
            <a
              className="link"
              href="https://ballydidean.farm/donate"
              target="_blank"
              rel="noopener noreferrer"
            >
              a tax-deductible donation to Ballydídean Farm Sanctuary
            </a>{" "}
            to support animal welfare on Whidbey Island.
          </p>
          <div className="flex-grow" />
          <p className="mb-4 text-xs text-right mt-8">
            By{" "}
            <a
              className="link"
              href="https://ansel.santosa.family"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ansel Santosa
            </a>{" "}
            on Whidbey Island
          </p>
        </div>
      </div>
    </>
  );
};
