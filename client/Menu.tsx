import AndroidIcon from "~/images/icons/brands/android.svg";
import AppleIcon from "~/images/icons/brands/apple.svg";
import ChevronLeftIcon from "~/images/icons/solid/chevron-left.svg";
import ChromeIcon from "~/images/icons/brands/chrome.svg";
import clsx from "clsx";
import ExternalLinkIcon from "~/images/icons/solid/external-link-square.svg";
import MenuIcon from "~/images/icons/solid/ellipsis-v.svg";
import PlusIcon from "~/images/icons/solid/plus-square.svg";
import React, { FC, ReactNode, useState } from "react";
import SafariIcon from "~/images/icons/brands/safari.svg";
import ShipIcon from "~/images/icons/solid/ship.svg";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

enum Platform {
  android = "android",
  ios = "ios",
}

const InstallStep: FC = ({ children }) => (
  <div className="mx-2 w-4 text-center inline-block">{children}</div>
);

const InstallInstructions: FC = () => {
  const [platform, setPlatform] = useState<Platform | undefined>();

  const isInstalled = window.matchMedia("(display-mode: standalone)").matches;

  if (isInstalled) {
    return null;
  }

  let steps: ReactNode;

  if (platform === Platform.ios) {
    steps = (
      <ol className="my-2 list-decimal list-inside">
        <li>
          <InstallStep>
            <SafariIcon />
          </InstallStep>
          Safari
        </li>
        <li>
          <InstallStep>
            <ExternalLinkIcon />
          </InstallStep>
          Share
        </li>
        <li>
          <InstallStep>
            <PlusIcon />
          </InstallStep>
          Add to Home Screen
        </li>
      </ol>
    );
  } else if (platform === Platform.android) {
    steps = (
      <ol className="my-2 list-decimal list-inside">
        <li>
          <InstallStep>
            <ChromeIcon />
          </InstallStep>
          Chrome
        </li>
        <li>
          <InstallStep>
            <MenuIcon />
          </InstallStep>
          Menu
        </li>
        <li>
          <InstallStep />
          Add to Home Screen
        </li>
      </ol>
    );
  } else {
    steps = (
      <div className="flex mt-4">
        <button
          className={clsx("button button-invert", "flex-grow")}
          onClick={() => setPlatform(Platform.ios)}
        >
          <AppleIcon className="inline-block button-icon text-2xl" />
          <span className="button-label">iOS</span>
        </button>
        <button
          className={clsx("button button-invert", "flex-grow ml-4")}
          onClick={() => setPlatform(Platform.android)}
        >
          <AndroidIcon className="inline-block button-icon text-2xl" />
          <span className="button-label">Android</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <h2 className="font-medium text-lg mt-8">Install App</h2>
      <div className="mt-2">
        Want to install Ferry FYI as an app on your homescreen?
      </div>
      {steps}
    </>
  );
};

export const Menu: FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0",
          "animate",
          isOpen ? "z-30" : "z-bottom pointer-events-none",
          isOpen ? "bg-darken-low" : "bg-transparent"
        )}
        onClick={onClose}
      />
      <nav
        className={clsx(
          "animate",
          "flex flex-col",
          "bg-green-dark text-white shadow-lg",
          "w-full h-screen max-w-xs",
          "fixed top-0 left-0 z-30",
          "pt-safe-top pb-safe-bottom pl-safe-left",
          isOpen ? "ml-0" : "-ml-96"
        )}
      >
        <div
          className={clsx("h-16 w-full p-4", "text-2xl", "flex items-center")}
        >
          <ShipIcon className="inline-block mr-4" />
          <h1 className="font-bold">Ferry FYI</h1>
          <div className="flex-grow" />
          <ChevronLeftIcon
            className="cursor-pointer text-md"
            onClick={onClose}
            aria-label="Close Menu"
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
          <InstallInstructions />
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
      </nav>
    </>
  );
};
