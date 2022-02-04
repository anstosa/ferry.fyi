import AppleIcon from "~/static/images/icons/brands/apple.svg";
import clsx from "clsx";
import ExternalLinkIcon from "~/static/images/icons/solid/external-link-square.svg";
import GooglePlayIcon from "~/static/images/icons/brands/google-play.svg";
import PlusIcon from "~/static/images/icons/solid/plus-square.svg";
import React, { FC, ReactElement, ReactNode, useState } from "react";
import SafariIcon from "~/static/images/icons/brands/safari.svg";

enum Platform {
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
          Open in Safari
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
        <a
          href="https://play.google.com/store/apps/details?id=fyi.ferry"
          className={clsx("button button-invert", "flex-grow ml-4")}
        >
          <GooglePlayIcon className="inline-block button-icon text-2xl" />
          <span className="button-label">Android</span>
        </a>
      </div>
    );
  }

  return (
    <>
      <h2 className="font-bold text-lg mt-8">Install App</h2>
      <div className="mt-2">Want to install Ferry FYI as an app?</div>
      {steps}
    </>
  );
};
