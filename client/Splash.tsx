import clsx from "clsx";
import React, { FC, ReactNode, useEffect, useState } from "react";

export const Splash: FC<{ message?: string }> = ({ message }) => {
  const [isHelpVisible, setHelpVisible] = useState<boolean>(false);
  const [mark, setMark] = useState<number>(0);
  const [tickTimer, setTickTimer] = useState<NodeJS.Timeout | null>(null);
  const [helpTimer, setHelpTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setTickTimer(
      setInterval(() => setMark((mark) => (mark === 2 ? 0 : mark + 1)), 600)
    );
    setHelpTimer(setTimeout(() => setHelpVisible(true), 20 * 1000));
    return () => {
      if (tickTimer) {
        clearInterval(tickTimer);
      }
      if (helpTimer) {
        clearTimeout(helpTimer);
      }
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
      <i className="fas fa-3x fa-ship" />
      <div className="w-12 flex justify-between mt-8">
        {[1, 2, 3].map((index) => (
          <i
            key={index}
            className={clsx(
              "fas fa-xs fa-circle",
              mark === index ? "visible" : "invisible"
            )}
          />
        ))}
      </div>
      {message && <span className="max-w-sm mt-8">{message}</span>}
      {renderHelp()}
    </div>
  );
};
