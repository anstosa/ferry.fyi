import React, {
  FC,
  PropsWithChildren,
  ReactNode,
  useEffect,
  useState,
} from "react";

import logo from "~/static/images/icon_monochrome-256.png";

import { LoadingWaves } from "./LoadingWaves";

export const Splash: FC<PropsWithChildren> = ({ children }) => {
  const [isHelpVisible, setHelpVisible] = useState<boolean>(false);

  useEffect(() => {
    const helpTimer = setTimeout(() => {
      setHelpVisible(true);
    }, 20 * 1000);
    return () => {
      clearTimeout(helpTimer);
    };
  }, []);

  const renderHelp = (): ReactNode => {
    // delayed help guard
    if (!isHelpVisible) {
      return null;
    }
    return (
      <div
        className="
          fixed inset-x-0 bottom-0 w-full h-20
          flex justify-center items-center
        "
      >
        Broken? Email
        <a
          className="link ml-1"
          href="mailto:dev@ferry.fyi"
          target="_blank"
          rel="noopener noreferrer"
        >
          dev@ferry.fyi
        </a>
      </div>
    );
  };

  return (
    <div
      className="
        bg-ferry-gradient text-white
        fixed inset-0 z-50
        flex flex-col justify-center items-center
      "
    >
      <img
        alt="Ferry FYI"
        className="w-20 splash-logo"
        height={80}
        src={logo}
        width={80}
      />
      <LoadingWaves className="mt-8" />
      {children && <span className="max-w-sm mt-8">{children}</span>}
      {renderHelp()}
    </div>
  );
};
