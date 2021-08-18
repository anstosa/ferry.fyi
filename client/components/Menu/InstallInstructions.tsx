import AndroidIcon from "~/images/icons/brands/android.svg";
import AppleIcon from "~/images/icons/brands/apple.svg";
import ChromeIcon from "~/images/icons/brands/chrome.svg";
import clsx from "clsx";
import ExternalLinkIcon from "~/images/icons/solid/external-link-square.svg";
import MenuIcon from "~/images/icons/solid/ellipsis-v.svg";
import PlusIcon from "~/images/icons/solid/plus-square.svg";
import React, { FC, ReactElement, ReactNode, useState } from "react";
import SafariIcon from "~/images/icons/brands/safari.svg";

enum Platform {
  android = "android",
  ios = "ios",
}

const InstallStep: FC = ({ children }) => (
  <div className="mx-2 w-4 text-center inline-block">{children}</div>
);

export const InstallInstructions = (): ReactElement | null => {
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
