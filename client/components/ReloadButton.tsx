import clsx from "clsx";
import { motion } from "framer-motion";
import React, {
  FunctionComponent,
  PropsWithChildren,
  ReactElement,
  useEffect,
  useState,
} from "react";

import ReloadIcon from "~/static/images/icons/solid/redo.svg";

interface SpinWrapperProps {
  isLoading: boolean;
}

/**
 * Wrap the button in a component that animates it
 * 360 degree spin and makes sure that it completes the current rotation before stopping
 **/
const SpinWrapper: FunctionComponent<PropsWithChildren<SpinWrapperProps>> = ({
  children,
  isLoading,
}) => {
  const [isLastSpin, setLastSpin] = useState(false);
  const [isSpinning, setSpinning] = useState<boolean>(false);
  const [spinInterval, setSpinInterval] = useState<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      setLastSpin(false);
      setSpinning(true);
      let spinCount = 0;
      const interval = window.setInterval(() => {
        spinCount++;
        if (isLastSpin || spinCount > 30) {
          setSpinning(false);
          if (interval) {
            window.clearInterval(interval);
          }
        }
      }, 1000);
      setSpinInterval(interval);
    } else {
      setLastSpin(true);
    }

    return () => {
      if (spinInterval) {
        window.clearInterval(spinInterval);
      }
    };
  }, [isLoading]);

  if (isSpinning) {
    return (
      <motion.div
        initial={{ transform: "rotate(0deg)" }}
        animate={{ transform: "rotate(360deg)" }}
        transition={{
          duration: 1,
          ease: "linear",
          repeat: Infinity,
        }}
      >
        {children}
      </motion.div>
    );
  } else {
    return <>{children}</>;
  }
};

interface Props {
  ariaLabel: string;
  className?: string;
  isReloading: boolean;
  onClick: () => void;
}
export const ReloadButton = ({
  ariaLabel,
  className,
  isReloading,
  onClick,
}: Props): ReactElement => (
  <button
    aria-busy={isReloading}
    aria-label={ariaLabel}
    className={clsx(
      "inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0 text-xl",
      className
    )}
    onClick={onClick}
    type="button"
  >
    <SpinWrapper isLoading={isReloading}>
      <ReloadIcon />
    </SpinWrapper>
  </button>
);
