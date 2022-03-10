import CircleIcon from "~/static/images/icons/solid/circle.svg";
import clsx from "clsx";
import logo from "~/static/images/icon_monochrome.png";
import React, { FC, ReactNode, useEffect, useState } from "react";

export const Splash: FC = ({ children }) => {
  const [isHelpVisible, setHelpVisible] = useState<boolean>(false);
  const [mark, setMark] = useState<number>(0);

  useEffect(() => {
    const tickTimer = setInterval(() => {
      console.log("interval");
      setMark((mark) => (mark === 3 ? 0 : mark + 1));
    }, 600);
    const helpTimer = setTimeout(() => {
      console.log("timeout");
      setHelpVisible(true);
    }, 20 * 1000);
    return () => {
      clearInterval(tickTimer);
      clearTimeout(helpTimer);
    };
  }, []);

  const renderHelp = (): ReactNode => {
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
        bg-green-dark text-white
        fixed inset-0
        flex flex-col justify-center items-center
      "
    >
      <img src={logo} className="w-20" />
      <div className="w-12 flex justify-between mt-8">
        {[1, 2, 3].map((index) => (
          <CircleIcon
            key={index}
            className={clsx(
              "text-sm",
              mark === index ? "visible" : "invisible"
            )}
          />
        ))}
      </div>
      {children && <span className="max-w-sm mt-8">{children}</span>}
      {renderHelp()}
    </div>
  );
};
