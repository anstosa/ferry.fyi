import React, {
  FC,
  PropsWithChildren,
  ReactNode,
  useEffect,
  useState,
} from "react";

import logo from "~/static/images/icon_monochrome.png";

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
      <img src={logo} className="w-20 splash-logo" />
      <div
        aria-label="Loading"
        className="relative mt-8 flex h-16 w-40 items-center justify-center"
        role="status"
      >
        <svg
          aria-hidden="true"
          className="splash-loader-waves"
          focusable="false"
          viewBox="0 0 160 48"
        >
          <path
            className="splash-loader-wave splash-loader-wave--back"
            d="M4 26 C18 14 34 14 48 26 S78 38 94 26 124 14 156 26"
          />
          <path
            className="splash-loader-wave splash-loader-wave--middle"
            d="M4 24 C20 10 36 10 52 24 S84 38 100 24 132 10 156 24"
          />
          <path
            className="splash-loader-wave splash-loader-wave--front"
            d="M4 29 C20 18 36 18 52 29 S84 40 100 29 132 18 156 29"
          />
        </svg>
      </div>
      {children && <span className="max-w-sm mt-8">{children}</span>}
      {renderHelp()}
    </div>
  );
};
